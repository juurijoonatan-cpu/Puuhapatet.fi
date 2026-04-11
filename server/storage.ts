// storage.ts — legacy in-memory stub, not used in production
// Real data access goes through server/db.ts + Drizzle ORM

export interface IStorage {
  getUser(id: number): Promise<{ id: number; username: string } | undefined>;
}

export class MemStorage implements IStorage {
  async getUser(_id: number) {
    return undefined;
  }
}

export const storage = new MemStorage();
