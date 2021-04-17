import { getPoll, isPollOpen } from "./db.ts";
import { lawIdRegex } from "./index.ts";
import { calcPollResult } from "./PollResult.ts";
import { Law, Poll } from "./types.ts";

export enum LawResultStatus {
    NeverPolled = "Has never been voted on",
    PollsGone = "No polls longer exist",
    LowQuorum = "No polls reached quorum",
    PollIsOpen = "Its poll is still open",
    Accepted = "Accepted",
    Rejected = "Rejected",
}

export type LawResult = {
    status: LawResultStatus;
    law: Law;
    poll?: Poll;
    pc?: number;
    numPolls?: number;
};

export async function lawResult(law: Law): Promise<LawResult> {
    if (!law.PollIds.length) {
        return { status: LawResultStatus.NeverPolled, law };
    }

    const results = (await Promise.all(law.PollIds.map(getPoll))).flatMap(({ poll }) =>
        poll ? [calcPollResult(poll)] : [],
    );

    if (!results.length) {
        return { status: LawResultStatus.PollsGone, law };
    }

    const polls = results.filter(r => r.reachedQuorum);
    if (!polls.length) {
        return { status: LawResultStatus.LowQuorum, law };
    }

    const closedPoll = polls.find(({ poll }) => !isPollOpen(poll));
    if (!closedPoll) {
        return { status: LawResultStatus.PollIsOpen, law };
    }

    const { averages, poll } = closedPoll;
    const average = Object.entries(averages).find(([option]) => lawIdRegex.test(option))?.[1] ?? 0;
    const pc = (average / poll.Width) * 100;

    return {
        status: pc >= 50 ? LawResultStatus.Accepted : LawResultStatus.Rejected,
        law,
        poll,
        pc,
        numPolls: polls.length,
    };
}
