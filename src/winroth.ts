/** 
 * To check if Winroth follows his own rules for message formatting.
 */


import allMessages from "../all_messages.json" with { type: "json" };

type Message = {
  content: string;
  author: string;
  channel: string;
  createdAt: string;
  link: string;
}

const winrothMessages = (allMessages as Message[]).filter(m => m.author === "winroth");

const illegalRegex = /^[a-z].*?[a-z]$/gm
const legalRegex = /^[A-Z].*?\.$/gm

const illegalMessages = winrothMessages
  .map(m => ({
    ...m, content: m.content
      .replaceAll("ä", "a")
      .replaceAll("Ä", "A")
      .replaceAll("ö", "o")
      .replaceAll("Ö", "O")
      .replaceAll("å", "a")
      .replaceAll("Å", "A")
      .trim()
  }))
  .filter(m => {
    try {
      new URL(m.content);
      return false; // It's a URL, ignore
    }
    catch {
      return true; // Not a URL, keep
    }
  })
  .filter(m => legalRegex.test(m.content))
// .filter(m => illegalRegex.test(m.content));

console.dir(illegalMessages, { depth: null });
console.log(illegalMessages.length);