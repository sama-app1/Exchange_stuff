/**
 * Telegram Link Exchange Bot - النسخة المحدثة
 * ترفض القنوات والمجموعات الخاصة/المغلقة
 */

const MESSAGES = {
    WELCOME: "👋 *أهلاً بك في بوت تبادل المجموعات العامة!*\n\nأرسل رابط مجموعتك، واحصل على رابط لمجموعة أخرى ،،، ملاحظه ، نحن لا نقبل القنوات أو المجموعات الخاصة حالياً. 🚀",
    SUCCESS: (title, link) => `✅ *تم قبول مجموعتك: ${title}*\n\n🔗 *رابط التبادل الخاص بك:*\n${link}`,
    DUPLICATE_USER: "⚠️ *لقد شاركت هذا الرابط من قبل!* أرسل رابطاً جديداً.",
    ONLY_GROUPS: "❌ *عذراً، هذا الرابط لقناة!*\nالبوت مخصص لتبادل المجموعات (Groups) فقط ولا يقبل القنوات (Channels).",
    PRIVATE_CHAT: "🔒 *عذراً، هذه المجموعة مغلقة أو خاصة!*\nنحن نقبل المجموعات العامة التي تحتوي على معرف (username) فقط لتسهيل التبادل.",
    INVALID_LINK: "❌ *الرابط غير صالح!* تأكد أنه رابط مجموعة عامة بصيغة: `https://t.me/username`",
    NO_LINKS_YET: "⌛ *شكراً لمساهمتك!* سنرسل لك روابط جديدة بمجرد توفرها.",
    PROFILE: (points) => `👤 *نقاط مساهماتك:* ${points}`
};

export default {
    async fetch(request, env) {
        if (request.method !== "POST") return new Response("OK");

        try {
            const payload = await request.json();
            if (!payload.message) return new Response("OK");

            const chatId = payload.message.chat.id.toString();
            const userText = payload.message.text || "";

            await env.DB.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)").bind(chatId).run();

            if (userText === "/start") {
                await sendMessage(chatId, MESSAGES.WELCOME, env.BOT_TOKEN);
                return new Response("OK");
            }

            if (userText === "/profile") {
                const user = await env.DB.prepare("SELECT points FROM users WHERE user_id = ?").bind(chatId).first();
                await sendMessage(chatId, MESSAGES.PROFILE(user.points), env.BOT_TOKEN);
                return new Response("OK");
            }

            // --- منطق فحص ومعالجة الروابط ---
            const telegramRegex = /https:\/\/t\.me\/([a-zA-Z0-9_]{5,})/;
            const match = userText.match(telegramRegex);

            if (match) {
                const username = match[1];
                const fullUrl = `https://t.me/${username}`;

                // 1. هل الرابط موجود في النظام؟
                let linkRow = await env.DB.prepare("SELECT id FROM links WHERE url = ?").bind(fullUrl).first();

                if (!linkRow) {
                    // 2. التحقق من نوع المجموعة عبر تلجرام
                    const chatInfo = await verifyChat(username, env.BOT_TOKEN);
                    
                    if (chatInfo.ok) {
                        const type = chatInfo.result.type;

                        // الفلترة: نرفض القنوات
                        if (type === "channel") {
                            await sendMessage(chatId, MESSAGES.ONLY_GROUPS, env.BOT_TOKEN);
                            return new Response("OK");
                        }

                        // الفلترة: نقبل فقط المجموعات (supergroup أو group)
                        if (type === "supergroup" || type === "group") {
                            const insertResult = await env.DB.prepare("INSERT INTO links (url, title) VALUES (?, ?) RETURNING id")
                                .bind(fullUrl, chatInfo.result.title).first();
                            linkRow = { id: insertResult.id };
                        } else {
                            await sendMessage(chatId, MESSAGES.PRIVATE_CHAT, env.BOT_TOKEN);
                            return new Response("OK");
                        }
                    } else {
                        // إذا فشل getChat، غالباً الرابط لمجموعة خاصة أو محذوفة
                        await sendMessage(chatId, MESSAGES.INVALID_LINK, env.BOT_TOKEN);
                        return new Response("OK");
                    }
                }

                // 3. فحص التكرار الشخصي للمستخدم
                const alreadySubmitted = await env.DB.prepare("SELECT 1 FROM submissions WHERE user_id = ? AND link_id = ?")
                    .bind(chatId, linkRow.id).first();

                if (alreadySubmitted) {
                    await sendMessage(chatId, MESSAGES.DUPLICATE_USER, env.BOT_TOKEN);
                } else {
                    // 4. تسجيل المساهمة وإعطاء رابط تبادل
                    await env.DB.batch([
                        env.DB.prepare("INSERT INTO submissions (user_id, link_id) VALUES (?, ?)").bind(chatId, linkRow.id),
                        env.DB.prepare("UPDATE users SET points = points + 1 WHERE user_id = ?").bind(chatId)
                    ]);

                    const randomLink = await env.DB.prepare(`
                        SELECT url FROM links 
                        WHERE id NOT IN (SELECT link_id FROM submissions WHERE user_id = ?) 
                        ORDER BY RANDOM() LIMIT 1
                    `).bind(chatId).first();

                    if (randomLink) {
                        const title = (await env.DB.prepare("SELECT title FROM links WHERE id = ?").bind(linkRow.id).first()).title;
                        await sendMessage(chatId, MESSAGES.SUCCESS(title, randomLink.url), env.BOT_TOKEN);
                    } else {
                        await sendMessage(chatId, MESSAGES.NO_LINKS_YET, env.BOT_TOKEN);
                    }
                }
            } else {
                // التعامل مع الروابط الخاصة (Invite Links) مثل t.me/+...
                if (userText.includes("t.me/+") || userText.includes("joinchat")) {
                    await sendMessage(chatId, MESSAGES.PRIVATE_CHAT, env.BOT_TOKEN);
                } else if (userText.startsWith("http")) {
                    await sendMessage(chatId, MESSAGES.INVALID_LINK, env.BOT_TOKEN);
                }
            }

        } catch (error) {
            console.error(error);
        }
        return new Response("OK");
    }
};

async function verifyChat(username, token) {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=@${username}`);
    return await response.json();
}

async function sendMessage(chatId, text, token) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" }),
    });
}
