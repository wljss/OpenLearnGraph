// @vitest-environment node
import type { WebContents } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../src/shared/contracts';

const electronMock = vi.hoisted(() => ({ on: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { on: electronMock.on } }));

import { hasUnsavedChanges, registerLifecycleIpc } from '../src/main/ipc/registerLifecycleIpc';

describe('lifecycle IPC', () => {
  beforeEach(() => electronMock.on.mockClear());

  it('tracks only validated boolean unsaved state from the sender', () => {
    registerLifecycleIpc();
    expect(electronMock.on).toHaveBeenCalledWith(IPC_CHANNELS.setUnsavedChanges, expect.any(Function));
    const listener = electronMock.on.mock.calls[0][1] as (
      event: { sender: WebContents },
      input: unknown,
    ) => void;
    const sender = {} as WebContents;

    listener({ sender }, true);
    expect(hasUnsavedChanges(sender)).toBe(true);
    listener({ sender }, 'true');
    expect(hasUnsavedChanges(sender)).toBe(true);
    listener({ sender }, false);
    expect(hasUnsavedChanges(sender)).toBe(false);
  });
});
