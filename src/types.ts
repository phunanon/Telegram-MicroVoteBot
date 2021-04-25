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
    Width: number;
    ChatPop: number;
    Quorum: QuorumType;
    Options: string[];
    Votes: { [voterId: number]: Vote };
}

export interface Law {
    TimeSec: number;
    Name: string;
    Body: string;
    PollIds: number[];
}

export interface Chat {
    Name: string;
    Quorum: QuorumType;
    DailyLimits: {
        MemberPolls: number;
        MemberLaws: number;
    };
    Users: { [userId: number]: User };
    Laws: Law[];
}

export interface User {
    LastSeenSec: number;
    Latest: {
        PollIds: number[];
        LawIds: number[];
    };
    DoNotify: boolean;
}

export enum VoteStatus {
    Success = "Vote cast successfully",
    Unauthorised = "You must message on the chat this poll was created, after its creation",
    Expired = "This poll expired",
    Nonexist = "Poll does not exist",
    InvalidNumOptions = "Invalid number of options",
    InvalidScore = "Scores must be between 1 and 5",
}

export enum NewItemStatus {
    UnknownError = "An unknown error occurred",
    RateLimited = "You have reached your maximum number of new items of this type per day",
    Success = "",
}

export const QuorumTypes = [
    "0",
    "1",
    "2",
    "3",
    "4",
    "n / 2",
    "sqrt(n * 2)",
    "sqrt(n)",
] as const;
export type QuorumType = typeof QuorumTypes[number];
