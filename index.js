export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    const payload = await request.json();
    if (!payload.message || !payload.message.text) return new Response("OK");

    const chatId = payload.message.chat.id;
    const userText = payload.message.text;

    // 1. استخراج المعرف (Username) من الرابط باستخدام Regex
    const telegramRegex = /https:\/\/t\.me\/([a-zA-Z0-9_]{5,})/;
    const match = userText.match(telegramRegex);

    if (match) {
      const username = match[1]; // هذا هو المعرف مثل "ExampleGroup"
      const fullLink = `https://t.me/${username}`;

      // 2. التحقق عبر getChat
      const chatInfo = await verifyChat(username, env.BOT_TOKEN);

      if (chatInfo.ok) {
        // التأكد أنها مجموعة أو قناة عامة وليست حساب شخصي
        const type = chatInfo.result.type;
        const title = chatInfo.result.title;

        if (type === "supergroup" || type === "group" || type === "channel") {
          try {
            // 3. التخزين في SQL
            await env.DB.prepare(
              "INSERT OR IGNORE INTO group_links (link, user_id) VALUES (?, ?)"
            ).bind(fullLink, chatId.toString()).run();

            // 4. سحب رابط عشوائي للتبادل
            const randomLink = await env.DB.prepare(
              "SELECT link FROM group_links WHERE link != ? ORDER BY RANDOM() LIMIT 1"
            ).bind(fullLink).first();

            let responseText = `✅ تم التحقق من المجموعة: *${title}*\n\n`;
            if (randomLink) {
              responseText += `🔗 إليك رابط مجموعة أخرى للتبادل:\n${randomLink.link}`;
            } else {
              responseText += "شكراً لك! سيتم عرض رابطك للمستخدمين القادمين.";
            }

            await sendMessage(chatId, responseText, env.BOT_TOKEN);
          } catch (err) {
            await sendMessage(chatId, "⚠️ خطأ فني في قاعدة البيانات.", env.BOT_TOKEN);
          }
        } else {
          await sendMessage(chatId, "❌ هذا الرابط لحساب شخصي، فضلاً أرسل رابط مجموعة أو قناة عامة.", env.BOT_TOKEN);
        }
      } else {
        await sendMessage(chatId, "❌ لم أتمكن من العثور على هذه المجموعة. تأكد أنها عامة وليست خاصة.", env.BOT_TOKEN);
      }
    } else {
      await sendMessage(chatId, "❌ الرابط غير صحيح. مثال: https://t.me/ExampleGroup", env.BOT_TOKEN);
    }

    return new Response("OK");
  },
};

// دالة التحقق من الدردشة
async function verifyChat(username, token) {
  const response = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=@${username}`);
  return await response.json();
}

// دالة إرسال الرسائل
async function sendMessage(chatId, text, token) {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: "Markdown" }),
  });
}
