import type { Pool, PoolClient } from 'pg';

import { SCOPED_POOL } from './workspace-write-scope.js';

const TRANSACTION_CLIENT=Symbol.for('themory.transactionClient');

/** Reuse the caller's transaction without letting nested adapters commit or release it. */
export function transactionPool(client:PoolClient):Pool {
  return new Proxy({} as Pool,{
    get(_target,property){
      if(property===TRANSACTION_CLIENT)return client;
      if(property===SCOPED_POOL)return true;
      if(property==='query')return client.query.bind(client);
      if(property==='connect')return ()=>Promise.resolve(new Proxy(client,{
        get(target,key){if(key==='release')return ()=>undefined;const value:unknown=Reflect.get(target,key);return typeof value==='function'?(...args:unknown[]):unknown=>Reflect.apply(value,target,args) as unknown:value;},
      }));
      if(property==='end')return ()=>{throw new Error('The transaction owner closes its pool.');};
      return undefined;
    },
  });
}
export function transactionClient(pool:Pool):PoolClient|undefined {
  return (pool as unknown as Record<symbol,PoolClient|undefined>)[TRANSACTION_CLIENT];
}
