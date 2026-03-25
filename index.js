export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    const payload = await request.json();
    if (!payload.message || !payload.message.text) return new Response("OK");

    const chatId = payload.message.chat.id;
    const userText = payload.message.text;

    // 1. استخراج المعرف (Username)
    const telegramRegex = /https:\/\/t\.me\/([a-zA-Z0-9_]{5,})/;
    const match = userText.match(telegramRegex);

    if (match) {
      const username = match[1];
      const fullLink = `https://t.me/${username}`;

      try {
        // 2. التحقق: هل أرسل هذا المستخدم هذا الرابط من قبل؟
        const existingRecord = await env.DB.prepare(
          "SELECT id FROM group_links WHERE link = ? AND user_id = ?"
        ).bind(fullLink, chatId.toString()).first();

        if (existingRecord) {
          // إذا كان الرابط موجوداً مسبقاً لهذا المستخدم
          await sendMessage(chatId, "⚠️ لقد أرسلت هذا الرابط مسبقاً! لا يمكنك الحصول على رابط جديد لنفس المجموعة.", env.BOT_TOKEN);
          return new Response("OK");
        }

        // 3. إذا كان الرابط جديداً، نتحقق منه عبر getChat
        const chatInfo = await verifyChat(username, env.BOT_TOKEN);

        if (chatInfo.ok) {
          const type = chatInfo.result.type;
          const title = chatInfo.result.title;

          if (["supergroup", "group", "channel"].includes(type)) {
            // 4. حفظ الرابط الجديد في قاعدة البيانات
            await env.DB.prepare(
              "INSERT INTO group_links (link, user_id) VALUES (?, ?)"
            ).bind(fullLink, chatId.toString()).run();

            // 5. سحب رابط عشوائي (بشرط ألا يكون نفس الرابط المُرسل)
            const randomLink = await env.DB.prepare(
              "SELECT link FROM group_links WHERE link != ? ORDER BY RANDOM() LIMIT 1"
            ).bind(fullLink).first();

            let responseText = `✅ تم قبول مجموعتك: *${title}*\n\n`;
            if (randomLink) {
              responseText += `🔗 إليك رابط مجموعة أخرى للتبادل:\n${randomLink.link}`;
            } else {
              responseText += "شكراً لك! سيتم عرض رابطك للمستخدمين القادمين.";
            }

            await sendMessage(chatId, responseText, env.BOT_TOKEN);
          } else {
            await sendMessage(chatId, "❌ هذا الرابط ليس لمجموعة أو قناة عامة.", env.BOT_TOKEN);
          }
        } else {
          await sendMessage(chatId, "❌ الرابط غير صالح أو المجموعة خاصة.", env.BOT_TOKEN);
        }
      } catch (err) {
        await sendMessage(chatId, "⚠️ حدث خطأ أثناء فحص البيانات.", env.BOT_TOKEN);
      }
    } else {
      await sendMessage(chatId, "❌ أرسل رابطاً صحيحاً (مثل: https://t.me/ExampleGroup)", env.BOT_TOKEN);
    }

    return new Response("OK");
  },
};

// الدوال المساعدة (verifyChat و sendMessage) تبقى كما هي في الكود السابق
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
