import { PostDetails } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  EPISODE_ID,
  PodcastDto,
} from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/podcast.dto';

export type PodcastConfig = { url: string; token: string };

export type PublishOutcome = 'published' | 'retry' | 'rejected';

export const readPodcastConfig = (
  env: NodeJS.ProcessEnv = process.env
): PodcastConfig | undefined => {
  const url = env.PODCASTS_API_URL?.trim().replace(/\/+$/, '');
  const token = env.PODCASTS_SERVICE_TOKEN?.trim();
  return url && token ? { url, token } : undefined;
};

export const episodeIdOf = ({
  settings,
  message,
}: Pick<PostDetails<PodcastDto>, 'settings' | 'message'>) => {
  const candidate = settings?.episodeId?.trim() || message?.trim() || '';
  return EPISODE_ID.test(candidate) ? candidate : undefined;
};

export const publishUrl = ({ url }: PodcastConfig, episodeId: string) =>
  `${url}/episodes/${encodeURIComponent(episodeId)}/publish`;

export const publishHeaders = ({ token }: PodcastConfig, postId: string) => ({
  Authorization: `Bearer ${token}`,
  'Idempotency-Key': postId,
  Accept: 'application/json',
});

export const publishOutcome = (status: number): PublishOutcome => {
  if (status >= 200 && status < 300) return 'published';
  if (status === 429 || status >= 500) return 'retry';
  return 'rejected';
};

export const rejectionMessage = (status: number, body: string) => {
  try {
    const parsed = JSON.parse(body);
    const message =
      parsed?.error?.message ||
      (typeof parsed?.error === 'string' && parsed.error) ||
      parsed?.message;
    if (typeof message === 'string' && message) return message;
  } catch (err) {
    /**empty**/
  }
  return `The podcasts API refused to publish the episode (HTTP ${status})`;
};

export const releaseUrlOf = (body: string) => {
  try {
    const url = JSON.parse(body)?.url;
    return typeof url === 'string' ? url : '';
  } catch (err) {
    return '';
  }
};
