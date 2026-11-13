import { withWorkspaceScope } from '@usetheo/memory';

/** Bind identity from authentication once; tool arguments contain only domain data. */
export function createWishlistStore(pool, actor) {
  return {
    async lookup(query) {
      return withWorkspaceScope(actor.workspaceId, async () => {
        const result = await pool.query(
          `SELECT item_id AS "recordId", item_name AS description FROM wishlist_items
           WHERE workspace_id=$1 AND user_id=$2 AND ($3::text IS NULL OR item_id=$3) ORDER BY item_id`,
          [actor.workspaceId, actor.userId, query.itemId ?? null],
        );
        return result.rows;
      });
    },
    async write(command) {
      return withWorkspaceScope(actor.workspaceId, async () => {
        const result = await pool.query(
          `INSERT INTO wishlist_items(workspace_id,user_id,item_id,item_name) VALUES($1,$2,$3,$4)
           ON CONFLICT(workspace_id,user_id,item_id) DO UPDATE SET item_name=EXCLUDED.item_name,updated_at=NOW()
           RETURNING item_id AS "recordId",item_name AS description`,
          [actor.workspaceId, actor.userId, command.itemId, command.name],
        );
        return result.rows[0];
      });
    },
  };
}
