/**
 * Telegram Link Exchange Bot - Cloudflare Workers & D1
 * نظام تبادل روابط متطور مع سجل مساهمات لكل مستخدم
 */

const MESSAGES = {
    WELCOME: "👋 *أهلاً بك في بوت تبادل الروابط الذكي!*\n\nنظامنا يعتمد على مبدأ المقايضة العادلة. أرسل رابط مجموعتك العامة، واحصل فوراً على رابط لمجموعة أخرى لم تكتشفها من قبل! 🚀\n\n💡 *كيف أبدأ؟*\nفقط أرسل رابط المجموعة هنا (مثال: `https://t.me/ExampleGroup`).\n\n📊 *أوامر تهمك:*\n/profile - لمشاهدة إحصائياتك.\n/my_links - لعرض روابطك التي شاركت بها.",
    SUCCESS: (title, link) => `✅ *تم قبول مساهمتك بنجاح!*\n\nرائع! تمت إضافة مجموعة: *${title}* إلى سجلك، وحصلت على نقطة مساهمة جديدة 🌟.\n\n🔗 *رابط التبادل الخاص بك:*\n${link}\n\n_أرسل رابطاً آخر للحصول على مجموعة جديدة!_`,
    DUPLICATE_USER: "⚠️ *عذراً، هذا الرابط مسجل في سجلك بالفعل!*\nيرجى إرسال رابط جديد لم يسبق لك مشاركته لتتمكن من الحصول على رابط تبادل آخر.",
    INVALID_LINK: "❌ *عذراً، الرابط غير صالح!*\nتأكد أن المجموعة *عامة* وأن الرابط بصيغة: `https://t.me/username`",
    NO_LINKS_YET: "⌛ *شكراً لمساهمتك!*\nأنت من أوائل المشاركين حالياً. سيتم عرض رابطك للمستخدمين القادمين، وسنرسل لك روابط جديدة بمجرد توفرها!",
    PROFILE: (points) => `👤 *ملفك الشخصي:*\n\n✅ الروابط التي شاركتها: *${points}*\n\n_كلما شاركت روابط أكثر، زادت فرصة ظهور روابطك للآخرين!_`
};

export default {
    async fetch(request, env) {
        if (request.method !== "POST") return new Response("OK");

        try {
            const payload = await request.json();
            if (!payload.message) return new Response("OK");

            const chatId = payload.message.chat.id.toString();
            const userText = payload.message.text || "";

            // 1. تسجيل/تحديث المستخدم في النظام
            await env.DB.prepare("INSERT OR IGNORE INTO users (user_id) VALUES (?)").bind(chatId).run();

            // 2. معالجة الأوامر الأساسية
            if (userText === "/start") {
                await sendMessage(chatId, MESSAGES.WELCOME, env.BOT_TOKEN);
                return new Response("OK");
            }

            if (userText === "/profile") {
                const user = await env.DB.prepare("SELECT points FROM users WHERE user_id = ?").bind(chatId).first();
                await sendMessage(chatId, MESSAGES.PROFILE(user.points), env.BOT_TOKEN);
                return new Response("OK");
            }

            if (userText === "/my_links") {
                const myLinks = await env.DB.prepare(`
                    SELECT l.url FROM links l 
                    JOIN submissions s ON l.id = s.link_id 
                    WHERE s.user_id = ? 
                    ORDER BY s.created_at DESC
                `).bind(chatId).all();

                let listMsg = "📜 *روابطك التي شاركت بها:*\n\n";
                if (myLinks.results.length > 0) {
                    myLinks.results.forEach((row, i) => listMsg += `${i + 1}- ${row.url}\n`);
                } else {
                    listMsg = "أنت لم تشارك أي روابط بعد!";
                }
                await sendMessage(chatId, listMsg, env.BOT_TOKEN);
                return new Response("OK");
            }

            // 3. منطق فحص ومعالجة الروابط المرسلة
            const telegramRegex = /https:\/\/t\.me\/([a-zA-Z0-9_]{5,})/;
            const match = userText.match(telegramRegex);

            if (match) {
                const username = match[1];
                const fullUrl = `https://t.me/${username}`;

                // أ. فحص هل الرابط موجود في النظام عالمياً؟
                let linkRow = await env.DB.prepare("SELECT id, title FROM links WHERE url = ?").bind(fullUrl).first();

                if (!linkRow) {
                    // رابط جديد تماماً -> نتحقق منه عبر تلجرام
                    const chatInfo = await verifyChat(username, env.BOT_TOKEN);
                    if (chatInfo.ok && ["supergroup", "group", "channel"].includes(chatInfo.result.type)) {
                        const insertResult = await env.DB.prepare("INSERT INTO links (url, title) VALUES (?, ?) RETURNING id")
                            .bind(fullUrl, chatInfo.result.title).first();
                        linkRow = { id: insertResult.id, title: chatInfo.result.title };
                    } else {
                        await sendMessage(chatId, MESSAGES.INVALID_LINK, env.BOT_TOKEN);
                        return new Response("OK");
                    }
                }

                // ب. فحص هل هذا المستخدم أرسل هذا الرابط مسبقاً؟
                const alreadySubmitted = await env.DB.prepare("SELECT 1 FROM submissions WHERE user_id = ? AND link_id = ?")
                    .bind(chatId, linkRow.id).first();

                if (alreadySubmitted) {
                    await sendMessage(chatId, MESSAGES.DUPLICATE_USER, env.BOT_TOKEN);
                } else {
                    // ج. تسجيل مساهمة جديدة وتحديث النقاط
                    await env.DB.batch([
                        env.DB.prepare("INSERT INTO submissions (user_id, link_id) VALUES (?, ?)").bind(chatId, linkRow.id),
                        env.DB.prepare("UPDATE users SET points = points + 1 WHERE user_id = ?").bind(chatId)
                    ]);

                    // د. البحث عن رابط تبادل عشوائي (لم يسبق للمستخدم رؤيته)
                    const randomLink = await env.DB.prepare(`
                        SELECT url FROM links 
                        WHERE id NOT IN (SELECT link_id FROM submissions WHERE user_id = ?) 
                        ORDER BY RANDOM() LIMIT 1
                    `).bind(chatId).first();

                    if (randomLink) {
                        await sendMessage(chatId, MESSAGES.SUCCESS(linkRow.title, randomLink.url), env.BOT_TOKEN);
                    } else {
                        await sendMessage(chatId, MESSAGES.NO_LINKS_YET, env.BOT_TOKEN);
                    }
                }
            } else {
                await sendMessage(chatId, "📥 يرجى إرسال رابط صحيح لمجموعة تليجرام عامة للتبادل.", env.BOT_TOKEN);
            }

        } catch (error) {
            console.error("Worker Error:", error);
        }

        return new Response("OK");
    }
};

/**
 * دالة التحقق من صحة الدردشة عبر API تلجرام
 */
async function verifyChat(username, token) {
    const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=@${username}`);
    return await response.json();
}

/**
 * دالة إرسال الرسائل بتنسيق Markdown
 */
async function sendMessage(chatId, text, token) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            chat_id: chatId,
            text: text,
            parse_mode: "Markdown",
            disable_web_page_preview: false
        }),
    });
}
