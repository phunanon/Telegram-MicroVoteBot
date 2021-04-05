import { exists } from "https://deno.land/std/fs/mod.ts";

const readJson = async (path: string) => JSON.parse(await Deno.readTextFile(path));
const writeJson = async (path: string, obj: any) => await Deno.writeTextFile(path, JSON.stringify(obj, null, 2));

export interface Vote {
    TimeSec: number,
    Choices: number[],
}

export interface Ballot {
    TimeSec: number,
    ChatId: number,
    LawId: string,
    Minutes: number,
    Name: string,
    Desc: string,
    Options: string[],
    Width: number,
    Votes: {[voterId: number]: Vote},
}

export const instanceOfBallot = (obj: any): obj is Ballot => obj.hasOwnProperty("Votes");

export interface Law {
    TimeSec: number,
    Name: string,
    Body: string,
}

export enum VoteStatus {
    Success = "Vote cast successfully",
    Unauthorised = "You must message on the chat this ballot was created, after its creation",
    Expired = "This ballot expired",
    Nonexist = "Ballot does not exist",
    InvalidNumOptions = "Invalid number of options",
}

export interface Chat {
    Name: string,
    LastSeenSec: {[userId: number]: number},
    Laws: Law[],
}

export const secNow = () => Math.floor(Date.now() / 1000);
export const n2id = (n: number) => n.toString(36).toUpperCase();
export const id2n = (id: string) => parseInt(id, 36);


async function getChat (chatId: number):
  Promise<{chat: Chat, write: ((chat: Chat) => Promise<void>)}> {
    const fileName = `db/chat-${chatId}.json`;
    if (!(await exists(fileName))) {
        await writeJson(fileName, {Name: "", LastSeenSec: {}, laws: []});
    }
    return {
        chat: await readJson(fileName) as Chat,
        write: async (chat: Chat) => await writeJson(fileName, chat),
    };
}


export async function getBallot (ballotId: string):
  Promise<{ballot: Ballot | null, write: ((ballot: Ballot) => Promise<void>)}> {
    const fileName = `db/ballot-${ballotId}.json`;
    return {
        ballot: await exists(fileName) ? await readJson(fileName) as Ballot : null,
        write: async (ballot: Ballot) => await writeJson(fileName, ballot),
    }
}


export async function newBallot(ballot: Ballot) {
    const fileName = `db/ballot-${n2id(ballot.TimeSec)}.json`;
    await writeJson(fileName, ballot);
}


export async function castVote(ballotId: string, userId: number, choices: number[]):
  Promise<VoteStatus | Ballot> {
    const {ballot, write} = await getBallot(ballotId);
    if (!ballot) {
        return VoteStatus.Nonexist;
    }
    if (!ballotIsOpen(ballot)) {
        return VoteStatus.Expired;
    }
    if (!await userCanVote(ballot, userId)) {
        return VoteStatus.Unauthorised;
    }
    if (choices.length != ballot.Options.length) {
        return VoteStatus.InvalidNumOptions;
    }
    const vote: Vote = {
        TimeSec: secNow(),
        Choices: choices,
    };
    ballot.Votes[userId] = vote;
    await write(ballot);
    return ballot;
}


export async function getBallots(chatId: number = 0): Promise<Ballot[]> {
    const files = [...Deno.readDirSync("./db")].filter(d => d.isFile && d.name.startsWith("ballot"));
    const ballots = await Promise.all(files.map(async f => await readJson(`db/${f.name}`) as Ballot));
    return chatId ? ballots.filter(b => b.ChatId == chatId): ballots;
}


export async function getUserBallots(userId: number): Promise<Ballot[]> {
    const ballots = await getBallots();
    const approvals = await Promise.all(ballots.map(async b => await userCanVote(b, userId)));
    return ballots.filter((_, index) => approvals[index]);
}


export async function logUser(chatId: number, chatName: string, userId: number) {
    const {chat, write} = await getChat(chatId);
    chat.Name = chatName;
    chat.LastSeenSec = {...chat.LastSeenSec, [userId]: secNow()};
    await write(chat);
}


export const getLaws = async (chatId: number): Promise<Law[]> => (await getChat(chatId)).chat.Laws ?? [];


export async function newLaw(chatId: number, law: Law) {
    const {chat, write} = await getChat(chatId);
    chat.Laws = [...chat.Laws ?? [], law];
    write(chat);
}


export const ballotIsOpen = (ballot: Ballot): boolean => secNow() < ballot.TimeSec + (ballot.Minutes * 60);


export async function userCanVote(ballot: Ballot, userId: number): Promise<boolean> {
    const fileName = `db/chat-${ballot.ChatId}.json`;
    if (!(await exists(fileName))) {
        return false;
    }
    const {LastSeenSec: users} = (await readJson(fileName)) as Chat;
    if (!users[userId]) {
        return false;
    }
    const lastSeen = users[userId];
    return lastSeen < ballot.TimeSec + (ballot.Minutes * 60);
}
