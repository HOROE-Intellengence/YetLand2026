import { DEFAULT_USER_BOUNDARY, type Me } from '@yelan/shared';

export const mockMe: Me = {
  id: 'usr_mock_1',
  name: '测试用户',
  phone: '13800000000',
  ageVerified: false,
  narrativeBoundary: DEFAULT_USER_BOUNDARY,
  ifUnlocked: false,
  createdAt: '2026-05-01T00:00:00Z',
};
