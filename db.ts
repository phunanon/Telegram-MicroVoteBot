import { exists } from "https://deno.land/std/fs/mod.ts";
import { base62 } from "./base62.ts";

const readJson = async (path: string) => JSON.parse(await Deno.readTextFile(path));
const writeJson = async (path: string, obj: any) => await Deno.writeTextFile(path, JSON.stringify(obj, null, 2));

export interface Vote {
    TimeSec: number,
    Choices: number[],
}

export interface Poll {
    TimeSec: number,
    ChatId: number,
    Minutes: number,
    Name: string,
    Desc: string,
    Options: string[],
    Width: number,
    Votes: {[voterId: number]: Vote},
}

export const instanceOfPoll = (obj: any): obj is Poll => obj.hasOwnProperty("Votes");

export interface Law {
    TimeSec: number,
    Name: string,
    Body: string,
    LatestPollId: number | null,
}

export enum VoteStatus {
    Success = "Vote cast successfully",
    Unauthorised = "You must message on the chat this poll was created, after its creation",
    Expired = "This poll expired",
    Nonexist = "Poll does not exist",
    InvalidNumOptions = "Invalid number of options",
}

export interface Chat {
    Name: string,
    LastSeenSec: {[userId: number]: number},
    Laws: Law[],
}

export const secNow = () => Math.floor((Date.now() - Date.UTC(2021, 3, 1)) / 1000);
export const n2id = base62.encode;
export const id2n = base62.decode;


async function getChat (chatId: number):
  Promise<{chat: Chat | null, write: ((chat: Chat) => Promise<void>)}> {
    const fileName = `db/chat-${chatId}.json`;
    return {
        chat: await exists(fileName) ? await readJson(fileName) as Chat : null,
        write: async (chat: Chat) => await writeJson(fileName, chat),
    };
}


export async function getPoll (pollId: number):
  Promise<{poll: Poll | null, write: ((poll: Poll) => Promise<void>)}> {
    const fileName = `db/poll-${pollId}.json`;
    return {
        poll: await exists(fileName) ? await readJson(fileName) as Poll : null,
        write: async (poll: Poll) => await writeJson(fileName, poll),
    }
}


export async function getLaw (chatId: number, lawId: number):
  Promise<{law: Law | null, write: ((law: Law) => Promise<void>) | null}> {
    const {chat, write} = await getChat(chatId);
    if (!chat) {
        return {law: null, write: null};
    }
    return {law: getLawFromChat(chat, lawId), write: (law: Law) => write(chat)};
}


export function getLawFromChat (chat: Chat, lawId: number): Law | null {
    return chat.Laws.find(l => l.TimeSec == lawId) ?? null;
}


export async function getPollResult (poll: Poll): Promise<{Option: string, Average: number}[]> {
    const votes = Object.values(poll.Votes);
    const sums = votes.reduce((sums, v) => sums.map((s, i) => s + v.Choices[i]), poll.Options.map(() => 0));
    return sums.map((s, i) => ({Option: poll.Options[i], Average: s / votes.length}));
}


export async function newPoll(poll: Poll, lawIds: number[]) {
    await (await getPoll(poll.TimeSec)).write(poll);
    const {chat, write} = await getChat(poll.ChatId);
    if (!chat) {
        return;
    }
    lawIds.forEach(i => {
        const law = getLawFromChat(chat, i);
        if (law) {
            law.LatestPollId = poll.TimeSec;
        }
    });
    console.log(chat);
    await write(chat);
}


export async function castVote(pollId: number, userId: number, choices: number[]):
  Promise<VoteStatus | Poll> {
    const {poll, write} = await getPoll(pollId);
    if (!poll) {
        return VoteStatus.Nonexist;
    }
    if (!pollIsOpen(poll)) {
        return VoteStatus.Expired;
    }
    if (!await userCanVote(poll, userId)) {
        return VoteStatus.Unauthorised;
    }
    if (choices.length != poll.Options.length) {
        return VoteStatus.InvalidNumOptions;
    }
    const vote: Vote = {
        TimeSec: secNow(),
        Choices: choices,
    };
    poll.Votes[userId] = vote;
    await write(poll);
    return poll;
}


export async function getPolls(chatId: number = 0): Promise<Poll[]> {
    const files = [...Deno.readDirSync("./db")].filter(d => d.isFile && d.name.startsWith("poll"));
    const polls = await Promise.all(files.map(async f => await readJson(`db/${f.name}`) as Poll));
    return chatId ? polls.filter(b => b.ChatId == chatId): polls;
}


export async function getUserPolls(userId: number): Promise<Poll[]> {
    const polls = await getPolls();
    const approvals = await Promise.all(polls.map(async b => await userCanVote(b, userId)));
    return polls.filter((_, index) => approvals[index]);
}


export async function logUser(chatId: number, chatName: string, userId: number) {
    let {chat, write} = await getChat(chatId);
    if (!chat) {
        chat = <Chat>{Name: "", LastSeenSec: {}, Laws: []};
        await write(chat);
    }
    chat.Name = chatName;
    chat.LastSeenSec = {...chat.LastSeenSec, [userId]: secNow()};
    await write(chat);
}


export const getLaws = async (chatId: number): Promise<Law[]> => (await getChat(chatId)).chat?.Laws ?? [];


export async function newLaw(chatId: number, law: Law): Promise<void> {
    const {chat, write} = await getChat(chatId);
    if (!chat) {
        return;
    }
    chat.Laws = [...chat.Laws ?? [], law];
    write(chat);
}


export const pollIsOpen = (poll: Poll): boolean => secNow() < poll.TimeSec + (poll.Minutes * 60);


export async function userCanVote(poll: Poll, userId: number): Promise<boolean> {
    const fileName = `db/chat-${poll.ChatId}.json`;
    if (!(await exists(fileName))) {
        return false;
    }
    const {LastSeenSec: users} = (await readJson(fileName)) as Chat;
    if (!users[userId]) {
        return false;
    }
    const lastSeen = users[userId];
    return lastSeen < poll.TimeSec + (poll.Minutes * 60);
}