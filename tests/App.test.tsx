import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/renderer/App';

describe('renderer smoke test', () => {
  beforeEach(() => {
    window.openLearnGraph = { graphs: {
      list: vi.fn().mockResolvedValue([]), create: vi.fn(), load: vi.fn(), save: vi.fn(),
    } };
  });
  it('loads the React shell and shows the empty graph state', async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByText('把学习目标变成一张活的知识地图')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /创建图谱/ })).toBeInTheDocument();
  });
});
