import { config } from "https://deno.land/x/dotenv/mod.ts";
import { Bot, Context } from "https://deno.land/x/telegram@v0.1.1/mod.ts";
import { State } from "https://deno.land/x/telegram@v0.1.1/context.ts";
import { castVote, newPoll, logUser, Poll, getLaws, Law, newLaw, VoteStatus, getUserPolls, n2id, secNow, getPoll, instanceOfPoll, pollIsOpen, id2n, getLaw, getPollResult } from "./db.ts";
import { LawResult, LawResultStatus, lawResult } from "./LawResult.ts";

const pollIdRegex = /^\[([0-9a-zA-Z]+)\]/;
export const lawIdRegex = /^\(?([0-9a-zA-Z]+)/;

const repeat = (x: any, n: number): any[] => n < 1 ? [] : [...new Array(Math.floor(n))].map(_ => x);
const repeatStr = (x: any, n: number): string => repeat(x, n).join("");
const plural = (n: number, w: string) => `${n} ${w.replace("_", n != 1 ? "s" : "")}`;
const drop1stLine = (lines: string): string => lines.split("\n").slice(1).join("\n");
const showChoiceAmount = (n: number, width: number): string => unicodeHorizontalBar(width, n / width);

type ShowPollOptions = {options?: boolean, desc?: boolean, amounts?: boolean}
function pollText (poll: Poll, show: ShowPollOptions, amounts: number[] = []) {
    const options = show.amounts
        ? poll.Options.map((o, i) => ({text: o, i, amount: amounts[i]}))
                      .sort((a, b) => b.amount - a.amount)
        : poll.Options.map((o, i) => ({text: o, i, amount: i}));
    return `<code>[${n2id(poll.TimeSec)}]</code> <b>${poll.Name}</b>` +
        (show.desc ? `\n${poll.Desc}` : "") +
        (show.options ? options.map(opt =>
            `\n<code>${show.amounts ? `${showChoiceAmount(opt.amount, poll.Width)} ${opt.amount.toFixed(2)}` : ""} </code> ${opt.i+1}. ${opt.text}`).join("") : "");
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
}


const sendMessage = async (ctx: Context<State>, text: string) => await ctx.telegram.sendMessage({chat_id: ctx.chat?.id ?? 0, text, parse_mode: "HTML"});


async function handlePoll(input: string, ctx: Ctx): Promise<string> {
    let [period, name, desc, ...options] = input.split("\n").map(str => str.trim());
    console.log(name);
    if (!period || !name || !desc || !options.length) {
        return await helpFor("poll");
    }
    const minutes = period.split(" ").reduce((min, txt) => {
        const {n, t} = txt.match(/(?<n>\d+)(?<t>[mhdMy])/)?.groups ?? ({});
        const m = 1, h = m * 60, d = h * 24, y = d * 365, M = y / 12;
        const times: {[key: string]: number} = {m, h, d, M, y};
        return min + (parseInt(n) * (times[t] || 0));
    }, 0);
    const poll: Poll = {
        TimeSec: secNow(),
        ChatId: ctx.chatId,
        Minutes: minutes,
        Name: name,
        Desc: desc,
        Options: options,
        Width: 5,
        Votes: {},
    };
    const laws = options.filter(o => lawIdRegex.test(o)).map( o => o.match(lawIdRegex)?.[1] ?? "");
    newPoll(poll, laws.map(i => id2n(i)));
    return `${pollText(poll, {})}\nYou must message in this chat prior to casting your vote, then use /mine in <a href="https://t.me/MicroVoteBot">this chat</a>.`;
}


async function handleVote(input: string, pollId: string, userId: number): Promise<string> {
    const choices = input.split(" ");
    const choiceNums = choices.map(s => parseInt(s));
    if (choiceNums.includes(Number.NaN)) {
        return "Please use only whole numbers to express your choice for a candidate.";
    }
    const pollOrStatus = await castVote(id2n(pollId), userId, choiceNums);
    if (instanceOfPoll(pollOrStatus)) {
        return `${pollText(pollOrStatus, {options: true, amounts: true}, choiceNums)}\n${VoteStatus.Success}.`;
    }
    return `${pollOrStatus}.`;
}


async function handleResult(input: string): Promise<string> {
    const pollId = input.match(pollIdRegex)?.[1];
    if (!pollId) {
        return "Invalid Poll ID.";
    }
    const {poll} = await getPoll(id2n(pollId));
    if (poll == null) {
        return "Poll not found.";
    }
    if (pollIsOpen(poll) && false) {
        return "This poll is still open; results can only be provided once the poll closes.";
    }
    const avgs = (await getPollResult(poll)).map(r => r.Average);
    return `${pollText(poll, {options: true, desc: true, amounts: true}, avgs)}\n${plural(Object.values(poll.Votes).length, "vote_")}`;
}


async function handleMine(input: string, ctx: Ctx): Promise<string> {
    const polls = await getUserPolls(ctx.userId);
    if (!polls.length) {
        return "There are no polls for you right now.";
    }
    polls.sort((a, b) => a.TimeSec - b.TimeSec).forEach((b, i) => {
        setTimeout(() => ctx.sendMessage(pollText(b, {options: true})), (i + 1) * 100);
    });
    return `To cast a vote, reply to each poll message with your choices such as:<code> 0 3 5 2</code>
You can re-vote by doing the same again or replying to your own vote message.
Polls you can vote in now:`;
}


const showLawResult = ({status, law, pc}: LawResult): string =>
    `<b>${status}</b>${[LawResultStatus.Accepted, LawResultStatus.Rejected].includes(status) ? ` at ${pc.toFixed(2)}% approval.` : ""}\n${lawText(law)}`;


async function handleLaw(input: string, ctx: Ctx): Promise<string> {
    const lawId = input.match(lawIdRegex)?.[1];
    if (!lawId) {
        return "Invalid Law ID.";
    }
    const {law} = await getLaw(ctx.chatId, id2n(lawId));
    if (!law) {
        return "Law not found.";
    }
    return showLawResult(await lawResult(law));
}


async function handleNewLaw(input: string, ctx: Ctx): Promise<string> {
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
    newLaw(ctx.chatId, law);
    return lawText(law);
}


async function handleLaws(input: string, ctx: Ctx): Promise<string> {
    const laws = await getLaws(ctx.chatId);
    const showAll = input.toLowerCase() == "all";
    const results = (await Promise.all(laws.map(lawResult))).filter(r => showAll || r.status == LawResultStatus.Accepted);
    return laws.length
        ? `${plural(results.length, "law_")}\n\n${(await Promise.all(results.map(showLawResult))).join("\n\n-----\n\n")}`
        : "There are no laws for this chat.";
}


const getAllHelp = async () => (await Deno.readTextFile("help.txt")).split("\n\n\n");


async function handleHelp() {
    return (await getAllHelp()).map(h => `${h.split("\n")[0]}\n<pre>${drop1stLine(h)}</pre>`).join("\n");
}


async function handleStart() {
    return "Welcome.";
}


async function helpFor(what: string): Promise<string> {
    const help = drop1stLine((await getAllHelp()).find(h => h.startsWith(`/${what}`)) ?? "")
    return help ? help : "No help found.";
}


type Ctx = {chatId: number, userId: number, sendMessage: (text: string) => void};

type Command = {
    test: RegExp,
    handler: (input: string, ctx: Ctx) => Promise<string>,
};

const actions: Command[] = [
    {test: /\/start/,    handler: handleStart},
    {test: /\/newpoll/,  handler: handlePoll},
    {test: /\/result/,   handler: handleResult},
    {test: /\/mine/,     handler: handleMine},
    {test: /\/newlaw\s/, handler: handleNewLaw},
    {test: /\/law\s/,    handler: handleLaw},
    {test: /\/laws/,     handler: handleLaws},
    {test: /\/help/,     handler: handleHelp},
];

async function handleMessage (ctx: Context<State>) {
    if (ctx.chat == undefined || ctx.message == undefined || ctx.message.from == undefined || ctx.message.text == undefined) {
        return;
    }
    const text = ctx.message.text;
    const input = text.replace(/.+?\s(.+)/, "$1").trim();
    const chatId = Math.abs(ctx.chat.id);
    const chatName = ctx.chat.id == ctx.me.id ? "Myself" : ctx.chat.title ?? "Unknown";
    const userId = ctx.message.from.id;

    //Log user activity in this chat for future authorisation
    logUser(chatId, chatName, userId);

    //Check if user is replying to one of our poll messages (voting)
    if (ctx.message.reply_to_message?.from?.id == (await ctx.telegram.getMe()).id) {
        const voteMessage = ctx.message.reply_to_message.text ?? "";
        if (pollIdRegex.test(voteMessage)) {
            const pollId = voteMessage.match(pollIdRegex)?.[1];
            if (pollId) {
                sendMessage(ctx, text == "/result"
                    ? await handleResult(`[${pollId}]`)
                    : await handleVote(text, pollId, ctx.message.from?.id ?? 0));
            }
            return;
        }
    }

    const action = actions.find(a => a.test.test(text))?.handler;
    if (!action) {
        return;
    }

    const [what, help] = text.split(" ");
    if (help == "help") {
        sendMessage(ctx, await helpFor(what.slice(1)));
        return;
    }

    await sendMessage(ctx, await action(input, {chatId, userId, sendMessage: (text: string) => sendMessage(ctx, text)}));
}


const token = config().BOT_TOKEN;
const bot = new Bot(token);
bot.telegram.setMyCommands([]);
bot.on("text", handleMessage);
bot.launch();