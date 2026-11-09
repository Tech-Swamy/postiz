jest.mock('@gitroom/helpers/utils/timer', () => ({
  timer: jest.fn(() => Promise.resolve()),
}));

import { ApplicationFailure } from '@temporalio/activity';
import { timer } from '@gitroom/helpers/utils/timer';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  PodcastProvider,
  PUBLISH_RETRIES,
} from '@gitroom/nestjs-libraries/integrations/social/podcast.provider';

const reply = (status: number, body = '') =>
  new Response(status === 204 ? null : body, { status });

const details = (settings: Record<string, string> = { episodeId: 'ep_1' }) => [
  { id: 'post-1', message: 'New episode', settings },
];

describe('PodcastProvider', () => {
  const provider = new PodcastProvider();
  const fetchMock = jest.fn();
  const env = process.env;

  beforeEach(() => {
    process.env = {
      ...env,
      PODCASTS_API_URL: 'https://api.example.com/',
      PODCASTS_SERVICE_TOKEN: 'secret',
    };
    fetchMock.mockReset();
    (timer as jest.Mock).mockClear();
    global.fetch = fetchMock;
  });

  afterAll(() => {
    process.env = env;
  });

  describe('post', () => {
    it('publishes the episode with the service token and idempotency key', async () => {
      fetchMock.mockResolvedValue(
        reply(200, '{"url":"https://pod.example.com/e/1"}')
      );

      await expect(provider.post('id', 'token', details())).resolves.toEqual([
        {
          id: 'post-1',
          status: 'completed',
          postId: 'ep_1',
          releaseURL: 'https://pod.example.com/e/1',
        },
      ]);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/episodes/ep_1/publish',
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer secret',
            'Idempotency-Key': 'post-1',
            Accept: 'application/json',
          },
        }
      );
    });

    it('takes the episode ID from the post text when the setting is empty', async () => {
      fetchMock.mockResolvedValue(reply(204));

      const [result] = await provider.post('id', 'token', [
        { id: 'post-2', message: 'ep_9', settings: {} },
      ]);

      expect(result.postId).toBe('ep_9');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://api.example.com/episodes/ep_9/publish'
      );
    });

    it('treats any 2xx as published', async () => {
      fetchMock.mockResolvedValue(reply(202, '{}'));

      const [result] = await provider.post('id', 'token', details());

      expect(result).toMatchObject({ status: 'completed', releaseURL: '' });
    });

    it('fails permanently on a 4xx without retrying', async () => {
      fetchMock.mockResolvedValue(
        reply(422, '{"error":{"message":"Episode has no audio"}}')
      );

      const error = await provider
        .post('id', 'token', details())
        .catch((err) => err);

      expect(error).toBeInstanceOf(BadBody);
      expect(error.type).toBe('bad_body');
      expect(error.message).toBe('Episode has no audio');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('retries a 5xx and succeeds when the API recovers', async () => {
      fetchMock
        .mockResolvedValueOnce(reply(503))
        .mockResolvedValueOnce(reply(500))
        .mockResolvedValueOnce(reply(200, '{}'));

      const [result] = await provider.post('id', 'token', details());

      expect(result.status).toBe('completed');
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(timer).toHaveBeenCalledTimes(2);
      fetchMock.mock.calls.forEach(([, init]) =>
        expect(init.headers['Idempotency-Key']).toBe('post-1')
      );
    });

    it('leaves a lasting 5xx to the post workflow as a retryable failure', async () => {
      fetchMock.mockResolvedValue(reply(502));

      const error = await provider
        .post('id', 'token', details())
        .catch((err) => err);

      expect(error).toBeInstanceOf(ApplicationFailure);
      expect(error).not.toBeInstanceOf(BadBody);
      expect(error.type).toBe('podcast_unavailable');
      expect(error.nonRetryable).toBe(false);
      expect(fetchMock).toHaveBeenCalledTimes(PUBLISH_RETRIES + 1);
    });

    it('retries when the API cannot be reached', async () => {
      fetchMock
        .mockRejectedValueOnce(new TypeError('fetch failed'))
        .mockResolvedValueOnce(reply(201, '{}'));

      const [result] = await provider.post('id', 'token', details());

      expect(result.status).toBe('completed');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('fails without calling the API when there is no episode ID', async () => {
      await expect(
        provider.post('id', 'token', [
          { id: 'post-3', message: 'Out now', settings: {} },
        ])
      ).rejects.toBeInstanceOf(BadBody);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fails without calling the API when it is not configured', async () => {
      delete process.env.PODCASTS_SERVICE_TOKEN;

      await expect(
        provider.post('id', 'token', details())
      ).rejects.toBeInstanceOf(BadBody);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('authenticate', () => {
    const code = (body: unknown) =>
      Buffer.from(JSON.stringify(body)).toString('base64');

    it('connects a named channel without OAuth', async () => {
      const auth = await provider.authenticate({
        code: code({ name: 'Tech Swamy Podcasts' }),
        codeVerifier: 'none',
      });

      expect(auth).toMatchObject({
        id: 'podcast_tech-swamy-podcasts',
        name: 'Tech Swamy Podcasts',
        username: 'tech-swamy-podcasts',
      });
      expect(typeof auth === 'object' && auth.accessToken).toBeTruthy();
    });

    it('refuses to connect when the env vars are missing', async () => {
      delete process.env.PODCASTS_API_URL;

      await expect(
        provider.authenticate({ code: code({ name: 'x' }), codeVerifier: '' })
      ).resolves.toMatch(/PODCASTS_API_URL/);
    });

    it('needs a name', async () => {
      await expect(
        provider.authenticate({ code: code({ name: ' ' }), codeVerifier: '' })
      ).resolves.toBe('Give the channel a name');
    });
  });
});
