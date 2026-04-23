import { DatabaseService } from '../database/database.service';
export declare class IdempotencyService {
    private readonly dbService;
    private readonly logger;
    constructor(dbService: DatabaseService);
    hashPayload(payload: unknown): string;
    check(key: string): {
        response: unknown;
        statusCode: number;
        payloadHash: string;
    } | null;
    store(key: string, payloadHash: string, response: unknown, statusCode: number): void;
    cleanup(): number;
}
