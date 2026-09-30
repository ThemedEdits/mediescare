import { describe, expect, it } from 'vitest';
import {
  CreateOrganisationBody,
  EnrollmentCodeBody,
  JoinOrganisationBody,
} from './branch-join-schemas';

const admin = { username: 'owner', fullName: 'Branch Owner', password: 'some-long-password-1' };

describe('setup bodies', () => {
  it('still accepts the original create body (with or without isHeadOffice)', () => {
    const base = { tenantName: 'Test Group', branchCode: 'HO01', branchName: 'Head Office', admin };
    expect(CreateOrganisationBody.parse({ ...base, isHeadOffice: true }).branchCode).toBe('HO01');
    expect(CreateOrganisationBody.parse(base).branchName).toBe('Head Office');
    expect(() => CreateOrganisationBody.parse({ ...base, branchCode: 'ho 1' })).toThrow();
  });

  it('accepts a join body and rejects a missing code or a bad username', () => {
    const ok = { mode: 'join', cloudUrl: 'https://cloud.example.test', code: 'ABCD-EFGH', admin };
    expect(JoinOrganisationBody.parse(ok).code).toBe('ABCD-EFGH');
    expect(() => JoinOrganisationBody.parse({ ...ok, code: '' })).toThrow();
    expect(() =>
      JoinOrganisationBody.parse({ ...ok, admin: { ...admin, username: 'Bad Name' } }),
    ).toThrow();
    expect(() => JoinOrganisationBody.parse({ ...ok, mode: 'create' })).toThrow();
  });

  it('normalises the branch code of an enrollment request', () => {
    expect(EnrollmentCodeBody.parse({ code: 'khi02', name: 'Branch Two' }).code).toBe('KHI02');
    expect(() => EnrollmentCodeBody.parse({ code: '02KHI', name: 'Branch Two' })).toThrow();
    expect(() => EnrollmentCodeBody.parse({ code: 'KHI02', name: 'x' })).toThrow();
  });
});
