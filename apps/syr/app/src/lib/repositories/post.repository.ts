import { BaseRepository } from './base.repository';
import { PostSchema, type Post } from '@syr-is/types';

export class PostRepository extends BaseRepository<Post> {
	protected tableName = 'post';
	protected schema = PostSchema;
}

export const postRepository = new PostRepository();
