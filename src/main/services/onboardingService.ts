import {
  updateOnboardingStatusInputSchema,
  type CreateOnboardingSampleResult,
  type OnboardingStateView,
} from '../../shared/contracts';
import type { OnboardingRepository } from '../repositories/onboardingRepository';

export class OnboardingService {
  constructor(private readonly repository: OnboardingRepository) {}

  getState(): OnboardingStateView {
    return this.repository.getState();
  }

  updateStatus(untrustedInput: unknown): OnboardingStateView {
    const parsed = updateOnboardingStatusInputSchema.safeParse(untrustedInput);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '上手引导状态无效');
    return this.repository.updateStatus(parsed.data.status);
  }

  createSample(): CreateOnboardingSampleResult {
    return this.repository.createSample();
  }

  deleteSample(): OnboardingStateView {
    return this.repository.deleteSample();
  }
}
