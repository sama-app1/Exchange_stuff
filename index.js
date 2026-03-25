export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("OK");

    const payload = await request.json();
    if (!payload.message) return new Response("OK");

    const chatId = payload.message.chat.id;
    const userText = payload.message.text || "";

    // أمر عرض الروابط الخاصة بالمستخدم
    if (userText === "/my_links") {
      const userLinks = await env.DB.prepare(
        "SELECT link FROM group_links WHERE user_id = ? ORDER BY created_at DESC"
      ).bind(chatId.toString()).all();

      if (userLinks.results.length > 0) {
        let listMsg = "📜 *روابطك التي شاركت بها:*\n\n";
        userLinks.results.forEach((row, i) => {
          listMsg += `${i + 1}- ${row.link}\n`;
        });
        await sendMessage(chatId, listMsg, env.BOT_TOKEN);
      } else {
        await sendMessage(chatId, "لم تشارك أي روابط بعد.", env.BOT_TOKEN);
      }
      return new Response("OK");
    }

    const telegramRegex = /https:\/\/t\.me\/([a-zA-Z0-9_]{5,})/;
    const match = userText.match(telegramRegex);

    if (match) {
      const username = match[1];
      const fullLink = `https://t.me/${username}`;

      try {
        // 1. الفحص: هل قام *هذا المستخدم* بإرسال *هذا الرابط* تحديداً من قبل؟
        const alreadySentByMe = await env.DB.prepare(
          "SELECT id FROM group_links WHERE link = ? AND user_id = ?"
        ).bind(fullLink, chatId.toString()).first();

        if (alreadySentByMe) {
          await sendMessage(chatId, "⚠️ لقد أرسلت هذا الرابط مسبقاً! يرجى إرسال رابط جديد للحصول على تبادل.", env.BOT_TOKEN);
          return new Response("OK");
        }

        // 2. التحقق من صحة الرابط عبر تلجرام
        const chatInfo = await verifyChat(username, env.BOT_TOKEN);

        if (chatInfo.ok && ["supergroup", "group", "channel"].includes(chatInfo.result.type)) {
          // 3. حفظ الرابط (حتى لو كان موجوداً لمستخدم آخر، سيُحفظ لهذا المستخدم أيضاً)
          await env.DB.prepare(
            "INSERT INTO group_links (link, user_id) VALUES (?, ?)"
          ).bind(fullLink, chatId.toString()).run();

          // 4. إعطاء رابط تبادل (بشرط ألا يكون من ضمن قائمة الروابط التي أرسلها هذا المستخدم أبداً)
          const randomLink = await env.DB.prepare(
            "SELECT link FROM group_links WHERE user_id != ? ORDER BY RANDOM() LIMIT 1"
          ).bind(chatId.toString()).first();

          let responseText = `✅ تم قبول الرابط! شكراً لمساهمتك في مجموعة: *${chatInfo.result.title}*\n\n`;
          if (randomLink) {
            responseText += `🔗 إليك رابط لمجموعة أخرى للتبادل:\n${randomLink.link}`;
          } else {
            responseText += "أنت تساهم في بناء القاعدة، سيتم إرسال روابطك للمستخدمين القادمين.";
          }
          await sendMessage(chatId, responseText, env.BOT_TOKEN);
        } else {
          await sendMessage(chatId, "❌ الرابط غير صالح أو المجموعة خاصة.", env.BOT_TOKEN);
        }
      } catch (err) {
        await sendMessage(chatId, "⚠️ حدث خطأ فني.", env.BOT_TOKEN);
      }
    } else if (userText === "/start") {
      await sendMessage(chatId, "أهلاً بك! أرسل رابط مجموعة عامة للحصول على رابط آخر.\n\nيمكنك تكرار روابط أرسلها غيرك، لكن لا يمكنك تكرار روابطك الخاصة.", env.BOT_TOKEN);
    }

    return new Response("OK");
  },
};

// الدوال المساعدة تبقى كما هي...
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
