import { exists } from "https://deno.land/std/fs/mod.ts";
import { base62 } from "./base62.ts";
import { Chat, Law, NewItemStatus, Poll, QuorumType, User, Vote, VoteStatus } from "./types.ts";

const readJson = async (path: string) => JSON.parse(await Deno.readTextFile(path));
const writeJson = async (path: string, obj: any) =>
    await Deno.writeTextFile(path, JSON.stringify(obj, null, 2));

export const secNow = () => Math.floor((Date.now() - Date.UTC(2021, 3, 1)) / 1000);
const dayAgoSecs = () => secNow() - 60 * 60 * 24;
export const n2id = base62.encode;
export const id2n = base62.decode;

async function getChat(
    chatId: number,
): Promise<{ chat: Chat | null; write: (chat: Chat) => Promise<void> }> {
    const fileName = `db/chat${chatId}.json`;
    return {
        chat: (await exists(fileName)) ? ((await readJson(fileName)) as Chat) : null,
        write: async (chat: Chat) => await writeJson(fileName, chat),
    };
}

export async function getPoll(
    pollId: number,
): Promise<{ poll: Poll | null; write: (poll: Poll) => Promise<void> }> {
    const fileName = `db/poll${pollId}.json`;
    return {
        poll: (await exists(fileName)) ? ((await readJson(fileName)) as Poll) : null,
        write: async (poll: Poll) => await writeJson(fileName, poll),
    };
}

export async function getLaw(
    chatId: number,
    lawId: number,
): Promise<{ law: Law | null; write: ((law: Law) => Promise<void>) | null }> {
    const { chat, write } = await getChat(chatId);
    if (!chat) {
        return { law: null, write: null };
    }
    return { law: getLawFromChat(chat, lawId), write: (law: Law) => write(chat) };
}

export function getLawFromChat(chat: Chat, lawId: number): Law | null {
    return chat.Laws.find(l => l.TimeSec == lawId) ?? null;
}

const calcQuorum = (chatPop: number, quorum: QuorumType): number =>
    eval(`const n = ${chatPop}, sqrt = Math.sqrt, floor = Math.floor, ceil = Math.ceil; ${quorum}`);

export async function calcChatQuorum(
    chatPop: number,
    chatId: number,
): Promise<{ quorum: number; type: QuorumType }> {
    const { chat } = await getChat(chatId);
    if (!chat) {
        return { quorum: 0, type: "0" };
    }
    return { quorum: calcQuorum(chatPop, chat.Quorum), type: chat.Quorum };
}

export const calcPollQuorum = (poll: Poll): number => calcQuorum(poll.ChatPop, poll.Quorum);

export function calcPollResult(
    poll: Poll,
): { reachedQuorum: boolean; result: { option: string; average: number }[] } {
    const votes = Object.values(poll.Votes);
    const sums = votes.reduce(
        (sums, v) => sums.map((s, i) => s + v.Choices[i]),
        poll.Options.map(() => 0),
    );
    return {
        reachedQuorum: calcQuorum(poll.ChatPop, poll.Quorum) <= votes.length,
        result: sums.map((s, i) => ({ option: poll.Options[i], average: s / votes.length })),
    };
}

function handleDailyRateLimits(
    chat: Chat,
    timeSec: number,
    userId: number,
    userProp: keyof User["Latest"],
    limitProp: keyof Chat["DailyLimits"],
): NewItemStatus {
    const user = chat.Users[userId];
    if (!user) {
        return NewItemStatus.UnknownError;
    }
    //Check if their Nth last item was within 24h
    if (
        user.Latest[userProp].length >= chat.DailyLimits[limitProp] &&
        user.Latest[userProp][chat.DailyLimits[limitProp] - 1] > dayAgoSecs()
    ) {
        return NewItemStatus.RateLimited;
    }
    user.Latest[userProp].unshift(timeSec);
    user.Latest[userProp] = user.Latest[userProp].slice(0, chat.DailyLimits[limitProp]);
    return NewItemStatus.Success;
}

export async function newPoll(
    poll: Poll,
    lawIds: number[],
    userId: number,
): Promise<NewItemStatus> {
    await (await getPoll(poll.TimeSec)).write(poll);
    const { chat, write } = await getChat(poll.ChatId);
    if (!chat) {
        return NewItemStatus.UnknownError;
    }
    const rateStatus = handleDailyRateLimits(chat, poll.TimeSec, userId, "PollIds", "MemberPolls");
    if (rateStatus != NewItemStatus.Success) {
        return rateStatus;
    }
    lawIds.forEach(i => {
        const law = getLawFromChat(chat, i);
        if (law) {
            law.LatestPollId = poll.TimeSec;
        }
    });
    await write(chat);
    return NewItemStatus.Success;
}

export async function castVote(
    pollId: number,
    userId: number,
    choices: number[],
    chatPop: number,
): Promise<{ status: VoteStatus; poll: Poll | null }> {
    const { poll, write } = await getPoll(pollId);
    if (!poll) {
        return { status: VoteStatus.Nonexist, poll: null };
    }
    if (!pollIsOpen(poll)) {
        return { status: VoteStatus.Expired, poll };
    }
    if (!(await userCanVote(poll, userId))) {
        return { status: VoteStatus.Unauthorised, poll };
    }
    if (choices.length != poll.Options.length) {
        return { status: VoteStatus.InvalidNumOptions, poll };
    }
    if (choices.some(c => c < 0 || c > 5)) {
        return { status: VoteStatus.InvalidScore, poll };
    }
    const vote: Vote = {
        TimeSec: secNow(),
        Choices: choices,
    };
    poll.Votes[userId] = vote;
    if (chatPop != 1) {
        poll.ChatPop = chatPop;
    }
    poll.Quorum = (await getChat(poll.ChatId)).chat?.Quorum ?? "0";
    await write(poll);
    return { status: VoteStatus.Success, poll };
}

export async function getPolls(chatId = 0): Promise<Poll[]> {
    const files = [...Deno.readDirSync("./db")].filter(d => d.isFile && d.name.startsWith("poll"));
    const polls = await Promise.all(files.map(async f => (await readJson(`db/${f.name}`)) as Poll));
    return chatId ? polls.filter(b => b.ChatId == chatId) : polls;
}

export async function getUserPolls(userId: number): Promise<Poll[]> {
    const polls = await getPolls();
    const approvals = await Promise.all(polls.map(async b => await userCanVote(b, userId)));
    return polls.filter((_, index) => approvals[index]);
}

export async function logUser(chatId: number, chatName: string, userId: number) {
    let { chat, write } = await getChat(chatId);
    if (!chat) {
        chat = <Chat>{
            Name: "",
            Users: {},
            Laws: [],
            Quorum: "0",
            DailyLimits: { MemberLaws: 4, MemberPolls: 4 },
        };
        await write(chat);
    }
    chat.Name = chatName;
    const user = chat.Users[userId];
    if (!user) {
        chat.Users = {
            ...chat.Users,
            [userId]: { LastSeenSec: secNow(), Latest: { PollIds: [], LawIds: [] } },
        };
    } else {
        user.LastSeenSec = secNow();
    }
    await write(chat);
}

export const getLaws = async (chatId: number): Promise<Law[]> =>
    (await getChat(chatId)).chat?.Laws ?? [];

export async function newLaw(law: Law, chatId: number, userId: number): Promise<NewItemStatus> {
    const { chat, write } = await getChat(chatId);
    if (!chat) {
        return NewItemStatus.UnknownError;
    }
    const rateStatus = handleDailyRateLimits(chat, law.TimeSec, userId, "LawIds", "MemberLaws");
    if (rateStatus != NewItemStatus.Success) {
        return rateStatus;
    }
    chat.Laws = [...(chat.Laws ?? []), law];
    await write(chat);
    return NewItemStatus.Success;
}

export const pollIsOpen = (poll: Poll): boolean => secNow() < poll.TimeSec + poll.Minutes * 60;

export async function userCanVote(poll: Poll, userId: number): Promise<boolean> {
    const { chat } = await getChat(poll.ChatId);
    if (!chat) {
        return false;
    }
    const user = chat.Users[userId];
    if (!user) {
        return false;
    }
    return user.LastSeenSec < poll.TimeSec + poll.Minutes * 60;
}

export async function setChatQuorum(chatId: number, quorum: QuorumType) {
    const { chat, write } = await getChat(chatId);
    if (chat) {
        chat.Quorum = quorum;
        await write(chat);
    }
}
