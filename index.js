export default {
  async fetch(request, env) {
    if (request.method === "POST") {
      const payload = await request.json();
      
      // التأكد أن التحديث يحتوي على رسالة نصية
      if (payload.message && payload.message.text) {
        const chatId = payload.message.chat.id;
        const text = payload.message.text;

        // إرسال رد إلى تلجرام
        await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: `وصلت رسالتك: ${text}`,
          }),
        });
      }
    }
    return new Response("OK", { status: 200 });
  },
};
