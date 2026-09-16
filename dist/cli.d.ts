#!/usr/bin/env node
import { Cli } from "incur";
/**
 * Whether the user asked incur to count or slice the output by tokens.
 *
 * These globals act on the value a command *returns*, so the ASCII fast path
 * (which writes to stdout itself) has to opt out of them — otherwise the flags
 * silently do nothing. See `emitAsciiOrData`.
 */
export declare function hasTokenFlag(argv: string[]): boolean;
/** Strip lone `--` so `calldiff a b -- src` still works with incur. */
export declare function normalizeArgv(argv: string[]): string[];
export declare const cli: Cli.Cli<{
    diff: {
        args: {
            from?: string | undefined;
            to?: string | undefined;
            paths?: string[] | undefined;
        };
        options: {
            maxDepth: number;
            locs: boolean;
            entry?: string | string[] | undefined;
            file?: string | string[] | undefined;
            from?: string | undefined;
            to?: string | undefined;
        };
    };
} & {
    tree: {
        args: {
            ref?: string | undefined;
            paths?: string[] | undefined;
        };
        options: {
            maxDepth: number;
            locs: boolean;
            entry?: string | string[] | undefined;
            file?: string | string[] | undefined;
        };
    };
} & {
    reach: {
        args: {
            ref?: string | undefined;
            paths?: string[] | undefined;
        };
        options: {
            to: string;
            maxDepth: number;
            locs: boolean;
            entry?: string | string[] | undefined;
            file?: string | string[] | undefined;
        };
    };
}, undefined, undefined, undefined>;
export default cli;
