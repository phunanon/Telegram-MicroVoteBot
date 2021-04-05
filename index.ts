import { config } from "https://deno.land/x/dotenv/mod.ts";
import { Bot, Context } from "https://deno.land/x/telegram@v0.1.1/mod.ts";
import { State } from "https://deno.land/x/telegram@v0.1.1/context.ts";
import { castVote, newBallot, logUser, Ballot, getLaws, Law, newLaw, VoteStatus, getUserBallots, n2id, secNow, getBallot, instanceOfBallot, ballotIsOpen } from "./db.ts";

const ballotIdRegex = /^\[([A-Z0-9]+)\]/;
const lawIdRegex = /\(?([A-Z0-9]+-[A-Z0-9]+)/;

const repeat = (x: any, n: number): any[] => n < 1 ? [] : [...new Array(Math.floor(n))].map(_ => x);
const repeatStr = (x: any, n: number): string => repeat(x, n).join("");
const plural = (n: number, w: string) => `${n} ${w.replace("_", n != 1 ? "s" : "")}`;
const drop1stLine = (lines: string): string => lines.split("\n").slice(1).join("\n");
const showChoiceAmount = (n: number, width: number): string => unicodeHorizontalBar(width, n / width);
const lawText = (l: Law, chatId: number) => `<code>(${n2id(chatId)}-${n2id(l.TimeSec)})</code> <b>${l.Name}</b>: ${l.Body}`;

type ShowBallotOptions = {options?: boolean, desc?: boolean, amounts?: boolean}
function ballotText (ballot: Ballot, show: ShowBallotOptions, amounts: number[] = []) {
    const options = show.amounts
        ? ballot.Options.map((o, i) => ({text: o, i, amount: amounts[i]}))
                        .sort((a, b) => b.amount - a.amount)
        : ballot.Options.map((o, i) => ({text: o, i, amount: i}));
    return `<code>[${n2id(ballot.TimeSec)}]</code> <b>${ballot.Name}</b>` +
        (show.desc ? `\n${ballot.Desc}` : "") +
        (show.options ? options.map(opt =>
            `\n<code>${show.amounts ? `${showChoiceAmount(opt.amount, ballot.Width)} ${opt.amount.toFixed(2)}` : ""} </code> ${opt.i+1}. ${opt.text}`).join("") : "");
}

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


async function handleBallot(input: string, ctx: Ctx): Promise<string> {
    let [period, name, desc, ...options] = input.split("\n");
    if (!period || !name || !desc || !options.length) {
        return await helpFor("ballot");
    }
    const minutes = period.split(" ").reduce((min, txt) => {
        const {n, t} = txt.match(/(?<n>\d+)(?<t>[mhdMy])/)?.groups ?? ({});
        const m = 1, h = m * 60, d = h * 24, y = d * 365, M = y / 12;
        const times: {[key: string]: number} = {m, h, d, M, y};
        return min + (parseInt(n) * (times[t] || 0));
    }, 0);
    const lawIdRegex = /^\(.+?\)/;
    const ballot: Ballot = {
        TimeSec: secNow(),
        ChatId: ctx.chatId,
        LawId: name.match(lawIdRegex)?.groups?.$1 || "",
        Minutes: minutes,
        Name: name.replace(lawIdRegex, "").trim(),
        Desc: desc,
        Options: options,
        Width: 5,
        Votes: {},
    };
    newBallot(ballot);
    return `${ballotText(ballot, {})}\nYou must message in this chat prior to casting your vote, then use /mine in <a href="https://t.me/MicroVoteBot">this chat</a>.`;
}


async function handleVote(input: string, ballotId: string, userId: number): Promise<string> {
    const choices = input.split(" ");
    const choiceNums = choices.map(s => parseInt(s));
    if (choiceNums.includes(Number.NaN)) {
        return "Please use only whole numbers to express your choice for a candidate.";
    }
    const ballotOrStatus = await castVote(ballotId, userId, choiceNums);
    if (instanceOfBallot(ballotOrStatus)) {
        return `${ballotText(ballotOrStatus, {options: true, amounts: true}, choiceNums)}\n${VoteStatus.Success}.`;
    }
    return `${ballotOrStatus}.`;
}


async function handleResult(input: string): Promise<string> {
    const ballotId = input.match(ballotIdRegex)?.[1];
    const {ballot} = await getBallot(ballotId ?? "");
    if (ballot == null) {
        return "Ballot not found.";
    }
    if (ballotIsOpen(ballot) && false) {
        return "This ballot is still open; results can only be provided once the ballot closes.";
    }
    const votes = Object.values(ballot.Votes);
    const sums = votes.reduce((sums, v) => sums.map((s, i) => s + v.Choices[i]), ballot.Options.map(() => 0));
    const avgs = sums.map(s => s / votes.length);
    return `${ballotText(ballot, {options: true, desc: true, amounts: true}, avgs)}\n${plural(votes.length, "vote_")}`;
}


async function handleMine(input: string, ctx: Ctx): Promise<string> {
    const ballots = await getUserBallots(ctx.userId);
    if (!ballots.length) {
        return "There are no ballots for you right now.";
    }
    ballots.forEach((b, i) => {
        setTimeout(() => ctx.sendMessage(ballotText(b, {options: true})), (i + 1) * 100);
    });
    return `To cast a vote, reply to each ballot message with your choices such as: <code> 0 3 5 2</code>
You can revote by doing the same again or replying to your own vote message.
Ballots you can vote in now:`;
}


async function handleLaw(input: string) {
    const lawId = input.match(lawIdRegex)?.[1];
    return "Erm";
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
    };
    newLaw(ctx.chatId, law);
    return lawText(law, ctx.chatId);
}


async function handleLaws(input: string, ctx: Ctx): Promise<string> {
    const laws = await getLaws(ctx.chatId);
    return laws.length ? laws.map(l => lawText(l, ctx.chatId)).join("\n-----\n") : "There are no laws for this chat.";
}


const getAllHelp = async () => (await Deno.readTextFile("help.txt")).split("\n\n");


async function handleHelp() {
    return (await getAllHelp()).map(h => `${h.split("\n")[0]}\n<pre>${drop1stLine(h)}</pre>`).join("\n");
}


async function handleStart() {
    return "Welcome.";
}


async function helpFor(what: string): Promise<string> {
    const help = drop1stLine((await getAllHelp()).find(h => h.startsWith(`/${what}`)) ?? "")
    return help ? `Usage of /${what}:\n<pre>${help}</pre>` : "No help found.";
}


type Ctx = {chatId: number, userId: number, sendMessage: (text: string) => void};
type Command = {
    test: RegExp,
    handler: (input: string, ctx: Ctx) => Promise<string>,
};

const actions: Command[] = [
    {test: /\/start/,     handler: handleStart},
    {test: /\/newballot/, handler: handleBallot},
    {test: /\/result/,    handler: handleResult},
    {test: /\/mine/,      handler: handleMine},
    {test: /\/newlaw\s/,  handler: handleNewLaw},
    {test: /\/law\s/,     handler: handleLaw},
    {test: /\/help/,      handler: handleHelp},
];

async function handleMessage (ctx: Context<State>) {
    if (ctx.chat == undefined || ctx.message == undefined || ctx.message.from == undefined || ctx.message.text == undefined) {
        return;
    }
    const text = ctx.message.text;
    const input = text.replace(/.+?\s(.+)/, "$1");
    const chatId = Math.abs(ctx.chat.id);
    const chatName = ctx.chat.id == ctx.me.id ? "Myself" : ctx.chat.title ?? "Unknown";
    const userId = ctx.message.from.id;

    //Log user activity in this chat for future authorisation
    logUser(chatId, chatName, userId);

    //Check if user is replying to one of our ballot messages (voting)
    if (ctx.message?.reply_to_message?.from?.id == (await ctx.telegram.getMe()).id) {
        const voteMessage = ctx.message.reply_to_message.text ?? "";
        if (ballotIdRegex.test(voteMessage)) {
            const ballotId = voteMessage.match(ballotIdRegex)?.[1];
            if (ballotId) {
                sendMessage(ctx, text == "/result"
                    ? await handleResult(`[${ballotId}]`)
                    : await handleVote(text, ballotId, ctx.message.from?.id ?? 0));
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