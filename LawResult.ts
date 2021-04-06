import { Law, getPoll, getPollResult } from "./db.ts";
import { lawIdRegex } from "./index.ts";

export enum LawResultStatus {
    NeverPolled = "Has never been voted on.",
    PollNonexist = "Historical poll no longer exists.",
    LowQuorum = "Its poll didn't reach quorum.",
    Accepted = "Accepted",
    Rejected = "Rejected"
}

export type LawResult = { status: LawResultStatus; law: Law; pc: number; };

export async function lawResult(law: Law): Promise<LawResult> {
    if (!law.LatestPollId) {
        return { status: LawResultStatus.NeverPolled, law, pc: 0 };
    }
    const { poll } = await getPoll(law.LatestPollId);
    if (!poll) {
        return { status: LawResultStatus.PollNonexist, law, pc: 0 };
    }
    const {reachedQuorum, result} = await getPollResult(poll);
    const pc = (result.find(o => lawIdRegex.test(o.option))?.average ?? 0) / poll.Width * 100;
    return {
        status: !reachedQuorum
            ? LawResultStatus.LowQuorum
            : (pc >= 50 ? LawResultStatus.Accepted : LawResultStatus.Rejected),
        law,
        pc
    };
}
