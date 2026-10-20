import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-api-gateway/client';
import type {} from '@deepseek-ai/dsh-api-session-controller/client';
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { TYPERT_REMOTE } from '../dsh/remote-contract.js';
import { DevelopmentClientController } from './controller.js';
import { DevelopmentIcon, DevelopmentPanel, type DevelopmentPanelInjected } from './DevelopmentPanel.js';

export const name = 'dsh-sfd-client';
export const inject = ['remote', 'slots', 'sessions'];

/** Global UI reads and operates the same Host domain as the scoped command. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE);
  // Host and Client both name a service `sessions`; this package checks both
  // halves together, so narrow that one boundary to the Client's public face.
  const sessions = ctx.get('sessions') as unknown as ISessions;
  const controller = new DevelopmentClientController(ctx.remote.developmentWorkflow);
  const stopPanel = ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main', key: 'sfd-development',
    inject: (): DevelopmentPanelInjected => ({ controller, sessionCatalog: sessions.list }),
  }, DevelopmentPanel));
  const stopIcon = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist', id: 'sfd-development', order: 20, label: 'Development',
  }, DevelopmentIcon));
  return async () => {
    controller.dispose();
    stopIcon();
    stopPanel();
    await unmount();
  };
}

export { DevelopmentClientController } from './controller.js';
export type { DevelopmentViewState } from './controller.js';
