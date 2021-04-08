export interface Vote {
    TimeSec: number;
    Choices: number[];
}

export interface Poll {
    TimeSec: number;
    ChatId: number;
    Minutes: number;
    Name: string;
    Desc: string;
    Options: string[];
    Width: number;
    ChatPop: number;
    Quorum: QuorumType;
    Votes: { [voterId: number]: Vote };
}

export const instanceOfPoll = (obj: any): obj is Poll => obj.hasOwnProperty("Votes");

export interface Law {
    TimeSec: number;
    Name: string;
    Body: string;
    LatestPollId: number | null;
}

export interface Chat {
    Name: string;
    LastSeenSec: { [userId: number]: number };
    Laws: Law[];
    Quorum: QuorumType;
}

export enum VoteStatus {
    Success = "Vote cast successfully",
    Unauthorised = "You must message on the chat this poll was created, after its creation",
    Expired = "This poll expired",
    Nonexist = "Poll does not exist",
    InvalidNumOptions = "Invalid number of options",
    InvalidScore = "Scores must be between 1 and 5",
}

export const QuorumTypes = ["0", "4", "ceil(sqrt(n * 2))", "floor(sqrt(n))"] as const;
export type QuorumType = typeof QuorumTypes[number];
