import { config } from "https://deno.land/x/dotenv/mod.ts";
import { Bot, Context } from "https://deno.land/x/telegram@v0.1.1/mod.ts";
import { State } from "https://deno.land/x/telegram@v0.1.1/context.ts";
import { castVote, newBallot, logUser, Ballot, getBallots, userCanVote } from "./db.ts";

async function handleBallot(input: string, ctx: Context<State>): Promise<string> {
    const [period, name, desc, ...options] = input.split("\n");
    if (!period || !name || !desc || !options.length) {
        return await helpFor("ballot");
    }
    const minutes = period.split(" ").reduce((min, txt) => {
        const {n, t} = txt.match(/(?<n>\d+)(?<t>[mhdMy])/)?.groups ?? ({});
        const m = 1, h = m * 60, d = h * 24, y = d * 365, M = y / 12;
        const times: {[key: string]: number} = {m, h, d, M, y};
        return min + (parseInt(n) * (times[t] || 0));
    }, 0);
    const ballot: Ballot = {
        TimeMs: Date.now(),
        ChatId: ctx.chat?.id.toString() ?? "",
        Minutes: minutes,
        Name: name,
        Desc: desc,
        Options: options,
        Votes: {},
    };
    newBallot(ballot);
    return `New ballot: ${ballot.Name}\nYou must message in this chat prior to casting your vote, then use /mine in [this chat](https://t.me/MicroVoteBot).`;
}

async function handleVote(input: string, voteMessage: string): Promise<string> {
    if (voteMessage == "") {
        return "Unknown error.";
    }
    return `${input} ${voteMessage}`;
}

async function handleResult(input: string): Promise<string> {
    return "Erm";
}

async function handleMine(input: string, ctx: Context<State>): Promise<string> {
    const ballots = await getBallots();
    if (!ballots.length) {
        return "No ballots available.";
    }
    const approvals = await Promise.all(ballots.map(async b => await userCanVote(b, ctx.message?.from?.id ?? 0)));
    const okBallots = ballots.filter((_, index) => approvals[index]);
    okBallots.forEach((b, i) => {
        setTimeout(() => ctx.telegram.sendMessage({
            chat_id: ctx.chat?.id ?? 0,
            text: `[${b.TimeMs.toString(36).toUpperCase()}] Ballot: ${b.Name}`,
        }), (i + 1) * 100);
    });
    return okBallots.length ? "Ballots you can vote in now:" : "There are no ballots for you right now.";
}

async function helpFor(what: string): Promise<string> {
    const helpFile = (await Deno.readTextFile("help.txt")).split("/");
    const help = helpFile.find(h => h.startsWith(what));
    return help ? `Usage of /${what}\`\`\`\n/${help}\`\`\`` : "No help found.";
}

async function handleMessage (ctx: Context<State>) {
    const text = ctx.message?.text ?? "";
    const input = text.replace(/.+?\s(.+)/, "$1");

    //Log user activity in this chat for future authorisation
    {
        const chatId = ctx.chat?.id;
        const from = ctx.message?.from;
        if (chatId && from) {
            logUser(chatId, from.id);
        } else {
            return;
        }
    }

    //Check if user is replying to one of our ballot messages (voting)
    if (ctx.message?.reply_to_message?.from?.id == (await ctx.telegram.getMe()).id) {
        if (/^\[[A-Z0-9]+\] Ballot/.test(ctx.message.reply_to_message.text ?? "")) {
            ctx.replyWithMarkdown(await handleVote(input, ctx.message?.reply_to_message?.text ?? ""));
            return;
        }
    }

    const actions: [RegExp, (input: string, ctx: Context<State>) => Promise<string>][] = [
        [/\/ballot/, handleBallot],
        [/\/result/, handleResult],
        [/\/mine/, handleMine],
    ];

    const action = actions.find(([r]) => r.test(text))?.[1];
    if (!action) {
        ctx.reply("No action found.");
        return;
    }

    const [what, help] = text.split(" ");
    if (help == "help") {
        ctx.reply(await helpFor(what.slice(1)));
        return;
    }

    await ctx.replyWithMarkdown(await action(input, ctx));
}

const token = config().BOT_TOKEN;
const bot = new Bot(token);
bot.on("text", handleMessage);
bot.launch();