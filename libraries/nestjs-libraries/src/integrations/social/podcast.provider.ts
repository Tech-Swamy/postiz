import { ApplicationFailure } from '@temporalio/activity';
import slugify from 'slugify';
import {
  AuthTokenDetails,
  PostDetails,
  PostResponse,
  SocialProvider,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';
import {
  BadBody,
  SocialAbstract,
} from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { makeSecureId } from '@gitroom/nestjs-libraries/services/make.secure.id';
import { setHeartbeatDetails } from '@gitroom/nestjs-libraries/temporal/temporal.heartbeat';
import { Rules } from '@gitroom/nestjs-libraries/chat/rules.description.decorator';
import { timer } from '@gitroom/helpers/utils/timer';
import { PodcastDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/podcast.dto';
import {
  episodeIdOf,
  PodcastConfig,
  publishHeaders,
  publishOutcome,
  publishUrl,
  readPodcastConfig,
  rejectionMessage,
  releaseUrlOf,
} from '@gitroom/nestjs-libraries/integrations/social/podcast.publish';

const YEARS_100 = 100 * 365 * 24 * 60 * 60;
export const PUBLISH_RETRIES = 3;
export const PUBLISH_RETRY_DELAY = 5000;

const NOT_CONFIGURED =
  'Podcast publishing is not configured: set PODCASTS_API_URL and PODCASTS_SERVICE_TOKEN';

@Rules(
  'A podcast post publishes one episode of the podcasts API when it comes due: put the episode ID in the episodeId setting, or as the whole post text'
)
export class PodcastProvider extends SocialAbstract implements SocialProvider {
  identifier = 'podcast';
  name = 'Podcast';
  isBetweenSteps = false;
  editor = 'normal' as const;
  scopes = [] as string[];
  override maxConcurrentJob = 5;
  dto = PodcastDto;

  maxLength() {
    return 1000;
  }

  async customFields() {
    return [
      {
        key: 'name',
        label: 'Channel name',
        defaultValue: 'Podcasts',
        validation: `/^.{1,64}$/`,
        type: 'text' as const,
        hint: 'The API address and token come from PODCASTS_API_URL and PODCASTS_SERVICE_TOKEN',
      },
    ];
  }

  async generateAuthUrl() {
    const state = makeSecureId(6);
    return { url: state, codeVerifier: makeSecureId(10), state };
  }

  async refreshToken(): Promise<AuthTokenDetails> {
    return {
      refreshToken: '',
      expiresIn: 0,
      accessToken: '',
      id: '',
      name: '',
      picture: '',
      username: '',
    };
  }

  async authenticate(params: {
    code: string;
    codeVerifier: string;
    refresh?: string;
  }) {
    if (!readPodcastConfig()) return NOT_CONFIGURED;

    let name = '';
    try {
      name = String(
        JSON.parse(Buffer.from(params.code, 'base64').toString()).name || ''
      ).trim();
    } catch (err) {
      return 'Give the channel a name';
    }
    if (!name) return 'Give the channel a name';

    const slug = slugify(name, { lower: true, strict: true }) || 'podcasts';
    return {
      refreshToken: '',
      expiresIn: YEARS_100,
      accessToken: makeSecureId(16),
      id: `podcast_${slug}`,
      name,
      picture: '',
      username: slug,
    };
  }

  async post(
    id: string,
    accessToken: string,
    postDetails: PostDetails<PodcastDto>[]
  ): Promise<PostResponse[]> {
    const [details] = postDetails;
    const config = readPodcastConfig();
    if (!config) {
      throw new BadBody(this.identifier, '{}', '{}', NOT_CONFIGURED);
    }

    const episodeId = episodeIdOf(details);
    if (!episodeId) {
      throw new BadBody(
        this.identifier,
        '{}',
        '{}',
        'Set the episode ID in the post settings, or make it the whole post text'
      );
    }

    const body = await this.publish(config, episodeId, details.id);
    return [
      {
        id: details.id,
        status: 'completed',
        postId: episodeId,
        releaseURL: releaseUrlOf(body),
      },
    ];
  }

  private async publish(
    config: PodcastConfig,
    episodeId: string,
    postId: string,
    attempt = 0
  ): Promise<string> {
    const url = publishUrl(config, episodeId);
    setHeartbeatDetails(`fetch ${url}`);

    let status = 0;
    let body = '';
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: publishHeaders(config, postId),
      });
      status = response.status;
      body = await response.text().catch(() => '');
    } catch (err) {
      body = String((err as Error)?.message || err);
    }

    const outcome = status ? publishOutcome(status) : 'retry';
    if (outcome === 'published') return body;

    if (outcome === 'rejected') {
      throw new BadBody(
        this.identifier,
        body || '{}',
        '{}',
        rejectionMessage(status, body)
      );
    }

    if (attempt < PUBLISH_RETRIES) {
      await timer(PUBLISH_RETRY_DELAY);
      return this.publish(config, episodeId, postId, attempt + 1);
    }

    throw ApplicationFailure.retryable(
      `The podcasts API is unavailable (${status ? `HTTP ${status}` : body})`,
      'podcast_unavailable'
    );
  }
}
