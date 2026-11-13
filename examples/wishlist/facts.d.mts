import type { Pool } from 'pg';
import type { SessionFactStore } from '@usetheo/memory';
export function createWishlistStore(pool:Pool,actor:{workspaceId:string;userId:string}):SessionFactStore<
  {itemId?:string},{itemId:string;name:string},{recordId:string;description:string}>;
