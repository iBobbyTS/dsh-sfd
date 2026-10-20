import { type ReactNode } from 'react';
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { DevelopmentRun } from '../core/types.js';
import { DevelopmentClientController } from './controller.js';
export interface SessionCatalog {
    getSnapshot(): SessionListState;
    subscribe(listener: () => void): () => void;
}
export interface DevelopmentPanelInjected {
    controller: DevelopmentClientController;
    sessionCatalog: SessionCatalog;
}
export declare function RunDetail({ run, busy, controller }: {
    run: DevelopmentRun;
    busy: boolean;
    controller: DevelopmentClientController;
}): ReactNode;
export declare function DevelopmentPanel({ controller, sessionCatalog }: PropsRuntime<'main'> & DevelopmentPanelInjected): ReactNode;
export declare function DevelopmentIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode;
