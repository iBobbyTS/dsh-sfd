import type { AdvisorNotice, AdvisorNotification, AdvisorPackage, DevelopmentRun } from '../core/types.js';
import type { AdvisorPort } from '../core/ports.js';
export declare class NativeAdvisorHandoff implements AdvisorPort {
    private readonly stateRoot?;
    private readonly python;
    private readonly secretFile;
    private readonly post;
    constructor(stateRoot?: string | undefined, python?: string, secretFile?: string, post?: typeof fetch);
    private root;
    pack(run: DevelopmentRun): Promise<AdvisorPackage>;
    saveHumanResponse(run: DevelopmentRun, advice: string, adoption: 'accept' | 'reject' | 'clarify', humanAnswer: string, action?: string): Promise<void>;
    notify(run: DevelopmentRun, pack: AdvisorPackage, fields: AdvisorNotice): Promise<AdvisorNotification>;
}
