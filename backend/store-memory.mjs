import { HttpError } from './auth.mjs';

export function createMemoryStore(seed = {}) {
  const items = new Map(Object.entries(seed));
  const key = (pk, sk) => pk + '\0' + sk;
  const write = item => { items.set(key(item.PK, item.SK), { ...item }); };
  const read = (pk, sk) => {
    const item = items.get(key(pk, sk));
    return item ? { ...item } : undefined;
  };
  const values = () => [...items.values()].map(item => ({ ...item }));
  return {
    async getAsset(id) { return read(`ASSET#${id}`, 'METADATA'); },
    async getByTag(tag) {
      const wanted = String(tag).toLowerCase();
      return values().find(item => item.SK === 'METADATA' && String(item.assetTag).toLowerCase() === wanted);
    },
    async listByUser(userId) {
      return values().filter(item => item.SK === 'METADATA' && item.assignedUserId === userId);
    },
    async listByDepartment(department) {
      return values().filter(item => item.SK === 'METADATA' && item.department === department);
    },
    async scanAssets() { return values().filter(item => item.SK === 'METADATA'); },
    async putAsset(item) { write(item); },
    async putRecord(item) { write(item); },
    async listRecords(id, prefix) { return values().filter(item => item.PK === `ASSET#${id}` && item.SK.startsWith(prefix)).sort((a,b) => b.SK.localeCompare(a.SK)); },
    async scanRecords(prefix) { return values().filter(item => item.SK.startsWith(prefix)); },
    async commitAsset(item, records, previousUpdatedAt) {
      const old = read(item.PK, item.SK);
      if ((previousUpdatedAt === null && old) || (previousUpdatedAt !== null && old?.updatedAt !== previousUpdatedAt)) throw new HttpError(409, 'Record changed; reload and try again');
      if (values().some(record => record.SK === 'METADATA' && record.assetId !== item.assetId && String(record.assetTag).toLowerCase() === String(item.assetTag).toLowerCase())) throw new HttpError(409, 'Asset tag already exists');
      write(item);
      for (const record of records) write(record);
    },
    async getProfile(sub) { return read(`USER#${sub}`, 'PROFILE'); },
    async putProfile(item) { write(item); },
  };
}

export function localUserId(group) {
  return 'local-' + group.toLowerCase();
}

export async function seedLocalAssets(store) {
  const now = '2024-01-15';
  const profiles = [
    ['Employee', 'IT'],
    ['Technician', 'IT'],
    ['Manager', 'Operations'],
    ['Administrator', 'Operations'],
    ['Auditor', 'Finance'],
  ];
  for (const [group, department] of profiles) {
    const sub = localUserId(group);
    await store.putProfile({
      PK: `USER#${sub}`, SK: 'PROFILE', subject: sub, department, email: `${group.toLowerCase()}@local.test`,
    });
  }
  const samples = [
    ['LAP-001', 'Laptop', 'IT', 'Employee', 'Assigned', 'Good'],
    ['LAP-002', 'Laptop', 'IT', 'Employee', 'Available', 'Excellent'],
    ['MON-010', 'Monitor', 'IT', 'Technician', 'Assigned', 'Fair'],
    ['PRN-003', 'Printer', 'Operations', 'Manager', 'In Maintenance', 'Poor'],
    ['SRV-100', 'Server', 'Operations', 'Administrator', 'Assigned', 'Good'],
    ['PHN-021', 'Phone', 'Operations', 'Manager', 'Checked Out', 'Good'],
    ['DSK-004', 'Desk', 'Finance', 'Auditor', 'Available', 'Excellent'],
    ['CHR-008', 'Chair', 'IT', 'Employee', 'Damaged', 'Poor'],
    ['RTR-002', 'Router', 'Operations', 'Technician', 'Assigned', 'Good'],
    ['TBL-011', 'Tablet', 'Finance', 'Auditor', 'Retired', 'Fair'],
  ];
  for (const [index, [assetTag, category, department, group, status, condition]] of samples.entries()) {
    const assignedUserId = localUserId(group);
    const assetId = `local-asset-${index + 1}`;
    await store.putAsset({
      PK: `ASSET#${assetId}`, SK: 'METADATA',
      GSI1PK: `TAG#${assetTag.toLowerCase()}`, GSI1SK: `ASSET#${assetId}`,
      GSI2PK: `USER#${assignedUserId}`, GSI2SK: `ASSET#${assetId}`,
      GSI3PK: `DEPT#${department}`, GSI3SK: `ASSET#${assetId}`,
      assetId, assetTag, category, description: `${category} used in ${department}`,
      manufacturer: 'ExampleCo', model: `X${index + 1}`, serialNumber: `SN-${1000 + index}`,
      purchaseDate: now, purchaseValue: 1500 - index * 50, salvageValue: 100, usefulLifeYears: 4,
      depreciationMethod: 'straight-line', assignedUserId, assignedEmail: `${group.toLowerCase()}@local.test`,
      department, building: 'HQ', room: String(100 + index), condition, status, problemNote: '',
      lastCleaningDate: '', lastMaintenanceDate: '', nextMaintenanceDate: '', expectedReplacementDate: '',
      photoKey: null, aiReviewStatus: 'none', createdAt: now + 'T00:00:00.000Z', updatedAt: now + 'T00:00:00.000Z',
    });
  }
  return store;
}
