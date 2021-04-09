import { config } from "https://deno.land/x/dotenv/mod.ts";
import { Bot, Context } from "https://deno.land/x/telegram@v0.1.1/mod.ts";
import { State } from "https://deno.land/x/telegram@v0.1.1/context.ts";
import {
    castVote,
    newPoll,
    logUser,
    getLaws,
    newLaw,
    getUserPolls,
    n2id,
    secNow,
    getPoll,
    isPollOpen,
    id2n,
    getLaw,
    calcPollResult,
    setChatQuorum,
    calcChatQuorum,
    calcPollQuorum,
} from "./db.ts";
import { LawResult, LawResultStatus, lawResult } from "./LawResult.ts";
import { makeConstitution } from "./MakeConstitution.ts";
import { exec } from "https://deno.land/x/2exec/mod.ts";
import { Law, NewItemStatus, Poll, QuorumType, QuorumTypes, VoteStatus } from "./types.ts";

const patrickId = 95914083;
const pollIdRegex = /^\[([0-9a-zA-Z]+)\]/;
export const lawIdRegex = /^\(?([0-9a-zA-Z]+)/;
const notAdminMessage = "You must be a group admin to use this action.";

const repeatStr = (x: string, n: number): string =>
    n < 1 ? "" : [...new Array(Math.floor(n))].map(_ => x).join("");
const plural = (n: number, w: string) => `${n} ${w.replace("_", n != 1 ? "s" : "")}`;
const drop1stLine = (lines: string): string => lines.split("\n").slice(1).join("\n");
const showChoiceAmount = (n: number, width: number): string =>
    unicodeHorizontalBar(width, n / width);

type ShowPollOptions = { options?: boolean; desc?: boolean; amounts?: boolean };
function pollText(poll: Poll, show: ShowPollOptions, amounts: number[] = []) {
    const options = show.amounts
        ? poll.Options.map((o, i) => ({ text: o, i, amount: amounts[i] })).sort(
              (a, b) => b.amount - a.amount,
          )
        : poll.Options.map((o, i) => ({ text: o, i, amount: i }));
    return (
        `<code>[${n2id(poll.TimeSec)}]</code> <b>${poll.Name}</b>` +
        (show.desc ? `\n${poll.Desc}` : "") +
        (show.options
            ? options
                  .map(
                      opt =>
                          `\n<code>${
                              show.amounts
                                  ? `${showChoiceAmount(
                                        opt.amount,
                                        poll.Width,
                                    )} ${opt.amount.toFixed(2)}`
                                  : ""
                          } </code> ${opt.i + 1}. ${opt.text}`,
                  )
                  .join("")
            : "")
    );
}

const lawText = (law: Law) => `<code>(${n2id(law.TimeSec)})</code> <b>${law.Name}</b>\n${law.Body}`;

const unicodeHorizontalBar = (width: number, fraction: number) => {
    fraction = Math.min(1, Math.max(fraction, 0));
    const wholeWidth = Math.floor(fraction * width);
    const remainderWidth = (fraction * width) % 1;
    const endWidth = width - wholeWidth - 1;
    const partWidth = Math.floor(remainderWidth * 8);
    const partChar = endWidth < 0 ? "" : [" ", "▏", "▎", "▍", "▌", "▋", "▊", "▉"][partWidth];
    return repeatStr("▉", wholeWidth) + partChar + repeatStr(" ", endWidth);
};

const sendMessage = async (ctx: Context<State>, text: string) =>
    await ctx.telegram.sendMessage({ chat_id: ctx.chat?.id ?? 0, text, parse_mode: "HTML" });

async function handlePoll(input: string, { chatId, chatPop, userId }: Ctx): Promise<string> {
    const [period, name, desc, ...options] = input.split("\n").map(str => str.trim());
    if (!period || !name || !desc || !options.length) {
        return await helpFor("poll");
    }
    const minutes = period.split(" ").reduce((min, txt) => {
        const { n, t } = txt.match(/(?<n>\d+)(?<t>[mhdMy])/)?.groups ?? {};
        const m = 1,
            h = m * 60,
            d = h * 24,
            y = d * 365,
            M = y / 12;
        const times: { [key: string]: number } = { m, h, d, M, y };
        return min + parseInt(n) * (times[t] || 0);
    }, 0);
    const poll: Poll = {
        TimeSec: secNow(),
        ChatId: chatId,
        Minutes: minutes,
        Name: name,
        Desc: desc,
        Options: options,
        Width: 5,
        ChatPop: chatPop,
        Quorum: "0",
        Votes: {},
    };
    const laws = options.filter(o => lawIdRegex.test(o)).map(o => o.match(lawIdRegex)?.[1] ?? "");
    const status = await newPoll(
        poll,
        laws.map(i => id2n(i)),
        userId,
    );
    if (status != NewItemStatus.Success) {
        return `${status}.`;
    }
    return `${pollText(
        poll,
        {},
    )}\nEither reply with your vote directly to this message\nor message in this chat prior to casting your vote, then use /mine in <a href="https://t.me/MicroVoteBot">this chat</a>.`;
}

async function handleVote(
    input: string,
    pollId: string,
    userId: number,
    chatPop: number,
): Promise<string> {
    const choices = input.split(" ");
    const choiceNums = choices.map(s => parseInt(s));
    if (choiceNums.includes(Number.NaN)) {
        return "";
    }
    const { status, poll } = await castVote(id2n(pollId), userId, choiceNums, chatPop);
    if (status == VoteStatus.Success && poll) {
        return `${pollText(poll, { options: true, amounts: true }, choiceNums)}\n${
            VoteStatus.Success
        }.`;
    }
    return `${status}.`;
}

async function handleResult(input: string): Promise<string> {
    const pollId = input.match(pollIdRegex)?.[1];
    if (!pollId) {
        return "Invalid Poll ID.";
    }
    const { poll } = await getPoll(id2n(pollId));
    if (poll == null) {
        return "Poll not found.";
    }
    if (isPollOpen(poll) && false) { //TODO
        return "This poll is still open; results can only be provided once the poll closes.";
    }
    const { reachedQuorum, result } = await calcPollResult(poll);
    const avgs = result.map(r => r.average);
    const numVotes = Object.values(poll.Votes).length;
    return `${pollText(poll, { options: true, desc: true, amounts: true }, avgs)}
<b>${plural(numVotes, "vote_")}, ${((numVotes / poll.ChatPop) * 100).toFixed(2)}% turnout</b>
<b>${reachedQuorum ? "Reached" : "Did not reach"}</b> its quorum of ${calcPollQuorum(poll)} with ${
        poll.ChatPop
    } potential voters.`;
}

async function handleMine(input: string, ctx: Ctx): Promise<string> {
    const polls = await getUserPolls(ctx.userId);
    if (!polls.length) {
        return "There are no polls for you right now.";
    }
    polls
        .sort((a, b) => a.TimeSec - b.TimeSec)
        .forEach((b, i) => {
            setTimeout(() => ctx.sendMessage(pollText(b, { options: true })), (i + 1) * 100);
        });
    return `To cast a vote, reply to each poll message with your choices, as scores from 0 to 5, such as:<code> 1 0 5 2</code>
The number of choices you provide will be the same as the number of options, e.g. if there is one option, you reply with one choice.
You can re-vote by doing the same again or replying to your own vote message.
Polls you can vote in now:`;
}

const showLawResult = ({ status, law, pc }: LawResult): string =>
    `<b>${status}</b>${
        [LawResultStatus.Accepted, LawResultStatus.Rejected].includes(status)
            ? ` at ${pc.toFixed(2)}% approval.`
            : ""
    }\n${lawText(law)}`;

async function handleLaw(input: string, ctx: Ctx): Promise<string> {
    const lawId = input.match(lawIdRegex)?.[1];
    if (!lawId) {
        return "Invalid Law ID.";
    }
    const { law } = await getLaw(ctx.chatId, id2n(lawId));
    if (!law) {
        return "Law not found.";
    }
    return showLawResult(await lawResult(law));
}

async function handleNewLaw(input: string, { chatId, userId }: Ctx): Promise<string> {
    const [name, ...body] = input.split("\n");
    if (!name || !body.length) {
        return await helpFor("law");
    }
    const law: Law = {
        TimeSec: secNow(),
        Name: name,
        Body: body.join("\n"),
        LatestPollId: null,
    };
    const status = await newLaw(law, chatId, userId);
    if (status != NewItemStatus.Success) {
        return `${status}.`;
    }
    return lawText(law);
}

async function handleLaws(input: string, ctx: Ctx): Promise<string> {
    const showAll = input.toLowerCase() == "all";
    const allResults = await Promise.all((await getLaws(ctx.chatId)).map(lawResult));
    const results = allResults.filter(r => showAll || r.status == LawResultStatus.Accepted);

    if (!allResults.length) {
        return "There are no laws for this chat.";
    }
    if (!results.length) {
        return "There are no activated laws for this chat. Perhaps try <code>/laws all</code>";
    }

    const pdfBytes = await makeConstitution(results, ctx.chatName);
    const fileName = `${ctx.chatName} ${showAll ? "Laws" : "Constitution"}.pdf`;
    await Deno.writeFile(fileName, pdfBytes);
    await Deno.writeTextFile(
        "uploadConstitution.sh",
        `curl -F document=@"${fileName}" https://api.telegram.org/bot${token}/sendDocument?chat_id=${ctx.chatId}`,
    );
    await exec(`sh uploadConstitution.sh`);
    await Deno.remove(fileName);
    await Deno.remove("uploadConstitution.sh");

    return "";
}

async function handleQuorum(input: string, ctx: Ctx): Promise<string> {
    if (!input) {
        const { quorum, type } = await calcChatQuorum(ctx.chatPop, ctx.chatId);
        return `
Function: <code>${type}</code>
Population: ${ctx.chatPop}
Calculated quorum: <b>${quorum}</b>`;
    }
    if (!ctx.isAdmin) {
        return notAdminMessage;
    }
    if (!QuorumTypes.some(t => t == input)) {
        return `Quorum type not found. Supported types:\n${QuorumTypes.map(
            t => `<code>${t}</code>`,
        ).join("\n")}`;
    }
    await setChatQuorum(ctx.chatId, input as QuorumType);
    return `Quorum set: <code>${input}</code>`;
}

const getAllHelp = async () => (await Deno.readTextFile("help.txt")).split("\n\n\n");

async function handleHelp() {
    return (await getAllHelp())
        .map(h => `${h.split("\n")[0]}\n<pre>${drop1stLine(h)}</pre>`)
        .join("\n");
}

async function handleStart() {
    return "Welcome.";
}

async function helpFor(what: string): Promise<string> {
    const help = drop1stLine((await getAllHelp()).find(h => h.startsWith(`/${what}`)) ?? "");
    return help ? help : "No help found.";
}

type Ctx = {
    chatId: number;
    userId: number;
    chatPop: number;
    chatName: string;
    isAdmin: boolean;
    sendMessage: (text: string) => void;
};

enum CommandArea {
    Group,
    Bot,
    Both,
}

type Command = {
    test: RegExp;
    handler: (input: string, ctx: Ctx) => Promise<string>;
    usedIn: CommandArea;
};

const actions: Command[] = [
    { test: /^\/start/, handler: handleStart, usedIn: CommandArea.Bot },
    { test: /^\/mine/, handler: handleMine, usedIn: CommandArea.Bot },
    { test: /^\/newpoll/, handler: handlePoll, usedIn: CommandArea.Group },
    { test: /^\/result/, handler: handleResult, usedIn: CommandArea.Both },
    { test: /^\/newlaw/, handler: handleNewLaw, usedIn: CommandArea.Group },
    { test: /^\/law\s/, handler: handleLaw, usedIn: CommandArea.Group },
    { test: /^\/laws/, handler: handleLaws, usedIn: CommandArea.Group },
    { test: /^\/quorum/, handler: handleQuorum, usedIn: CommandArea.Group },
    { test: /^\/help/, handler: handleHelp, usedIn: CommandArea.Both },
];

async function handleMessage(ctx: Context<State>): Promise<void> {
    if (
        ctx.chat == undefined ||
        ctx.message == undefined ||
        ctx.message.from == undefined ||
        ctx.message.text == undefined
    ) {
        return;
    }

    const text = ctx.message.text;
    const input = text.replace(/^\/\w+/, "").trim();
    const chatId = ctx.chat.id;
    const chatName = ctx.chat.id > 0 ? "Myself" : ctx.chat.title ?? "Unknown";
    const userId = ctx.message.from.id;
    const chatPop =
        ((await ctx.telegram.method("getChatMembersCount", { chat_id: ctx.chat.id })) as number) -
        1;
    const memberInfo = (await ctx.telegram.method("getChatMember", {
        chat_id: ctx.chat.id,
        user_id: userId,
    })) as { status: string };
    const isAdmin = ["creator", "administrator"].includes(memberInfo.status) || userId == patrickId;

    //Log user activity in this chat for future authorisation
    if (chatId < 0) {
        logUser(chatId, chatName, userId);
    }

    //Check if user is replying to one of our poll messages (voting)
    if (ctx.message.reply_to_message?.from?.id == (await ctx.telegram.getMe()).id) {
        const voteMessage = ctx.message.reply_to_message.text ?? "";
        if (pollIdRegex.test(voteMessage)) {
            await log([ctx.update.update_id, chatId, userId, text]);
            const pollId = voteMessage.match(pollIdRegex)?.[1];
            if (pollId) {
                const reply =
                    text == "/result"
                        ? await handleResult(`[${pollId}]`)
                        : await handleVote(text, pollId, userId, chatPop);
                if (reply) {
                    sendMessage(ctx, reply);
                }
            }
            return;
        }
    }

    const action = actions.find(a => a.test.test(text));
    if (!action) {
        return;
    }

    await log([ctx.update.update_id, chatId, userId, text]);

    if (userId != patrickId) {
        if (chatId > 0 && action.usedIn == CommandArea.Group) {
            sendMessage(
                ctx,
                "This action can only be used in a group chat with the bot as an admin member.",
            );
            return;
        }
        if (chatId < 0 && action.usedIn == CommandArea.Bot) {
            sendMessage(
                ctx,
                `This action can only be used <a href="https://t.me/MicroVoteBot">with the bot directly</a>.`,
            );
            return;
        }
    }

    const [what, help] = text.split(" ");
    if (help == "help") {
        sendMessage(ctx, await helpFor(what.slice(1)));
        return;
    }

    const message = await action.handler(input, {
        chatId,
        userId,
        chatPop,
        chatName,
        isAdmin,
        sendMessage: (text: string) => sendMessage(ctx, text),
    });
    if (message) {
        await sendMessage(ctx, message);
    }
}

async function log(entry: unknown) {
    await Deno.writeTextFile("log.txt", `${JSON.stringify(entry)}\n`, { append: true });
}

const token = config().BOT_TOKEN;
const bot = new Bot(token);
bot.telegram.setMyCommands([]);
bot.on("text", handleMessage);
bot.launch();
