import { config } from "https://deno.land/x/dotenv/mod.ts";
import { Bot, Context, Telegram } from "https://deno.land/x/telegram@v0.1.1/mod.ts";
import { State } from "https://deno.land/x/telegram@v0.1.1/context.ts";
import {
    castVote,
    newPoll,
    logUser,
    getLaws,
    newLaw,
    getUserPolls,
    secNow,
    getPoll,
    isPollOpen,
    id2n,
    getLaw,
    setChatQuorum,
    calcChatQuorum,
    setDailyLimit,
    getDailyLimit,
    getNotificationUsers,
    setUserDoNotify,
} from "./db.ts";
import { LawResultStatus, lawResult } from "./LawResult.ts";
import { makeConstitution } from "./MakeConstitution.ts";
import { exec } from "https://deno.land/x/2exec/mod.ts";
import { Chat, Law, NewItemStatus, Poll, QuorumType, QuorumTypes, VoteStatus } from "./types.ts";
import { lawText, plural, pollText, showLawResult } from "./display.ts";
import { toMin } from "./dates.ts";
import { getAllHelp } from "./fs.ts";
import { calcPollQuorum, calcPollResult } from "./PollResult.ts";

const patrickId = 95914083;
const pollIdRegex = /^\[([0-9a-zA-Z]+)\]/;
export const lawIdRegex = /^\(?([0-9a-zA-Z]+)/;
const notAdminMessage = "You must be a group admin to use this action.";

async function handleNewPoll({
    input,
    chatId,
    chatName,
    chatPop,
    userId,
    sendChatMessage,
}: Ctx): Promise<string> {
    const [period, name, desc, ...options] = input.split("\n").map(str => str.trim());
    if (!period || !name || !options.length) {
        return await helpFor("newpoll");
    }
    const minutes = toMin(period);
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
    const toNotify = await getNotificationUsers(chatId);
    toNotify.forEach(userId => {
        sendChatMessage(
            userId,
            `<b>Poll notification.</b>
A new poll, <b>${poll.Name}</b>, has been posted in the group chat <b>${chatName}</b>.
Either vote on it in the group chat, or send a message to the group chat, then return here and send <code>/mine</code>.
Use <code>/opt_out</code> or <code>/opt_in</code> in the group chat to change your notification preference.`,
        );
    });
    return `${pollText(
        poll,
        {},
    )}\nEither reply with your vote directly to this message\nor message in this chat prior to casting your vote, then send <code>/mine</code> to @MicroVoteBot.`;
}

async function handleVote(pollId: string, { input, userId, chatPop }: Ctx): Promise<string> {
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

async function handleResult({ input }: Ctx): Promise<string> {
    const pollId = input.match(pollIdRegex)?.[1];
    if (!pollId) {
        return "Invalid Poll ID.";
    }
    const { poll } = await getPoll(id2n(pollId));
    if (poll == null) {
        return "Poll not found.";
    }
    if (isPollOpen(poll) && false) {
        //TODO
        return "This poll is still open; results can only be provided once the poll closes.";
    }
    const { reachedQuorum, averages } = calcPollResult(poll);
    const numVotes = Object.values(poll.Votes).length;
    return `${pollText(poll, { options: true, desc: true, amounts: true }, Object.values(averages))}
<b>${plural(numVotes, "vote_")}, ${((numVotes / poll.ChatPop) * 100).toFixed(2)}% turnout</b>
<b>${reachedQuorum ? "Reached" : "Did not reach"}</b> its quorum of ${calcPollQuorum(poll)} with ${
        poll.ChatPop
    } potential voters.`;
}

async function handleMine({ userId, sendMessage }: Ctx): Promise<string> {
    const polls = await getUserPolls(userId);
    if (!polls.length) {
        return "There are no polls for you right now.";
    }
    polls
        .sort((a, b) => a.TimeSec - b.TimeSec)
        .forEach((b, i) => {
            setTimeout(() => sendMessage(pollText(b, { options: true })), (i + 1) * 100);
        });
    return `To cast a vote, reply to each poll message with your choices, as scores from 0 to 5, such as:<code> 1 0 5 2</code>
The number of choices you provide will be the same as the number of options, e.g. if there is one option, you reply with one choice.
You can re-vote by doing the same again or replying to your own vote message.
Polls you can vote in now:`;
}

async function handleLaw({ input, chatId }: Ctx): Promise<string> {
    const lawId = input.match(lawIdRegex)?.[1];
    if (!lawId) {
        return "Invalid Law ID.";
    }
    const { law } = await getLaw(chatId, id2n(lawId));
    if (!law) {
        return "Law not found.";
    }
    return showLawResult(await lawResult(law));
}

async function handleNewLaw({ input, chatId, userId }: Ctx): Promise<string> {
    const [name, ...body] = input.split("\n");
    if (!name || !body.length) {
        return await helpFor("law");
    }
    const law: Law = {
        TimeSec: secNow(),
        Name: name,
        Body: body.join("\n"),
        PollIds: [],
    };
    const status = await newLaw(law, chatId, userId);
    if (status != NewItemStatus.Success) {
        return `${status}.`;
    }
    return lawText(law);
}

async function handleLaws({ input, chatId, chatName }: Ctx): Promise<string> {
    const showAll = input.toLowerCase() == "all";
    const allResults = await Promise.all((await getLaws(chatId)).map(lawResult));
    const results = allResults.filter(r => showAll || r.status == LawResultStatus.Accepted);

    if (!allResults.length) {
        return "There are no laws for this chat.";
    }
    if (!results.length) {
        return "There are no activated laws for this chat. Perhaps try <code>/laws all</code>";
    }

    const pdfBytes = await makeConstitution(results, chatName);
    const fileName = `${chatName} ${showAll ? "All Laws" : "Laws"}.pdf`;
    await Deno.writeFile(fileName, pdfBytes);
    await Deno.writeTextFile(
        "uploadConstitution.sh",
        `curl -F document=@"${fileName}" https://api.telegram.org/bot${token}/sendDocument?chat_id=${chatId}`,
    );
    await exec(`sh uploadConstitution.sh`);
    await Deno.remove(fileName);
    await Deno.remove("uploadConstitution.sh");

    return "";
}

async function handleQuorum({ input, chatId, chatPop, isAdmin }: Ctx): Promise<string> {
    if (!input) {
        const { quorum, type } = await calcChatQuorum(chatPop, chatId);
        return `
Function: <code>${type}</code>
Population: ${chatPop}
Calculated quorum: <b>${quorum}</b>`;
    }
    if (!isAdmin) {
        return notAdminMessage;
    }
    if (!QuorumTypes.some(t => t == input)) {
        return `Quorum type not found. Supported types:\n${QuorumTypes.map(
            t => `<code>${t}</code>`,
        ).join("\n")}`;
    }
    await setChatQuorum(chatId, input as QuorumType);
    return `Quorum set: <code>${input}</code>`;
}

async function handleLimit({ chatId, actionName, input, isAdmin }: Ctx) {
    const limits: { [act: string]: keyof Chat["DailyLimits"] } = {
        poll_limit: "MemberPolls",
        law_limit: "MemberLaws",
    };
    if (!Object.keys(limits).includes(actionName)) {
        return "";
    }
    if (input && Number(input) && isAdmin) {
        await setDailyLimit(chatId, limits[actionName], Number(input));
    }
    return `<b>Daily limit per user</b>\n${limits[actionName]}: ${
        (await getDailyLimit(chatId, limits[actionName])) ?? NaN
    }`;
}

async function handleNotifyOpt({ actionName, chatId, userId }: Ctx): Promise<string> {
    if (!["opt_in", "opt_out"].includes(actionName)) {
        return "";
    }
    const optIn = actionName == "opt_in";
    await setUserDoNotify(chatId, userId, optIn);
    return `You will ${optIn ? "" : "no longer "}receive poll notifications for this group chat.${
        optIn
            ? "\nMake sure you have a chat with @MicroVoteBot otherwise it cannot notify you."
            : ""
    }`;
}

async function handleHelp() {
    const help = await getAllHelp();
    return Object.keys(help)
        .map(action => `/${action}\n${help[action]}`)
        .join("\n");
}

async function handleStart() {
    return "Welcome.";
}

async function helpFor(what: string): Promise<string> {
    return (await getAllHelp())[what] ?? "No help found.";
}

type Ctx = {
    actionName: string;
    input: string;
    chatId: number;
    userId: number;
    chatPop: number;
    chatName: string;
    isAdmin: boolean;
    sendMessage: (text: string) => void;
    sendChatMessage: (chatId: number, text: string) => void;
};

enum CommandArea {
    Group,
    Bot,
    Both,
}

type Command = {
    test: RegExp;
    handler: (ctx: Ctx) => Promise<string>;
    usedIn: CommandArea;
};

const actions: Command[] = [
    { test: /^\/start/, handler: handleStart, usedIn: CommandArea.Bot },
    { test: /^\/help/, handler: handleHelp, usedIn: CommandArea.Both },
    { test: /^\/results?/, handler: handleResult, usedIn: CommandArea.Both },
    { test: /^\/mine/, handler: handleMine, usedIn: CommandArea.Bot },
    { test: /^\/newpoll/, handler: handleNewPoll, usedIn: CommandArea.Group },
    { test: /^\/newlaw/, handler: handleNewLaw, usedIn: CommandArea.Group },
    { test: /^\/law\s/, handler: handleLaw, usedIn: CommandArea.Group },
    { test: /^\/laws/, handler: handleLaws, usedIn: CommandArea.Group },
    { test: /^\/quorum/, handler: handleQuorum, usedIn: CommandArea.Group },
    { test: /^\/(poll|law)_limit/, handler: handleLimit, usedIn: CommandArea.Group },
    { test: /^\/opt_(in|out)/, handler: handleNotifyOpt, usedIn: CommandArea.Group },
];

async function handleMessage({
    chat,
    message,
    telegram,
    update: { update_id: updateId },
}: Context<State>): Promise<void> {
    if (
        chat == undefined ||
        message == undefined ||
        message.from == undefined ||
        message.text == undefined
    ) {
        return;
    }

    const {
        text,
        reply_to_message: reply,
        from: { id: userId },
    } = message;
    const [_, actionName, input] = text.match(/^\/(\w+)(?:\s([\s\S]+))?/m)?.values() ?? [];
    const { id: chatId, title: chatTitle } = chat;
    const chatName = chatId > 0 ? "Myself" : chatTitle ?? "Unknown";
    const chatPop =
        ((await telegram.method("getChatMembersCount", { chat_id: chatId })) as number) - 1;
    const { status } = (await telegram.method("getChatMember", {
        chat_id: chatId,
        user_id: userId,
    })) as { status: string };
    const isAdmin = ["creator", "administrator"].includes(status) || userId == patrickId;

    //Log user activity in this chat for future authorisation
    if (chatId < 0) {
        logUser(chatId, chatName, userId);
    }

    const sendChatMessage = async (chatId: number, text: string) => {
        try {
            if (text) {
                await telegram.sendMessage({
                    chat_id: chatId,
                    text,
                    parse_mode: "HTML",
                    disable_notification: true,
                });
            }
        } catch (ex) {
            console.log(ex);
        }
    };
    const sendMessage = async (text: string) => await sendChatMessage(chatId, text);
    const log = async () =>
        await Deno.writeTextFile(
            "log.txt",
            `${JSON.stringify({ updateId, chatId, userId, text })}\n`,
            { append: true },
        );
    const customCtx: Ctx = {
        actionName,
        input: (input || "").trim(),
        chatId,
        userId,
        chatPop,
        chatName,
        isAdmin,
        sendMessage,
        sendChatMessage,
    };

    //Check if user is replying to one of our poll messages (voting)
    if (reply?.from?.id == (await telegram.getMe()).id) {
        const voteMessage = reply.text ?? "";
        if (pollIdRegex.test(voteMessage)) {
            await log();
            const pollId = voteMessage.match(pollIdRegex)?.[1];
            if (pollId) {
                sendMessage(
                    text == "/result"
                        ? await handleResult({ ...customCtx, input: `[${pollId}]` })
                        : await handleVote(pollId, { ...customCtx, input: text }),
                );
            }
            return;
        }
    }

    const action = actions.find(a => a.test.test(text));
    if (!action) {
        return;
    }

    await log();

    if (userId != patrickId) {
        if (chatId > 0 && action.usedIn == CommandArea.Group) {
            sendMessage(
                "This action can only be used in a group chat with the bot as an admin member.",
            );
            return;
        }
        if (chatId < 0 && action.usedIn == CommandArea.Bot) {
            sendMessage(
                `This action can only be used <a href="https://t.me/MicroVoteBot">with the bot directly</a>.`,
            );
            return;
        }
    }

    const [what, help] = text.split(" ");
    if (help == "help") {
        sendMessage(await helpFor(what.slice(1)));
        return;
    }

    await sendMessage(await action.handler(customCtx));
}

const token = config().BOT_TOKEN;
const bot = new Bot(token);
bot.telegram.setMyCommands([]);
bot.on("text", handleMessage);
bot.launch();
