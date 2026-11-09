import {
  episodeIdOf,
  publishHeaders,
  publishOutcome,
  publishUrl,
  readPodcastConfig,
  rejectionMessage,
  releaseUrlOf,
} from '@gitroom/nestjs-libraries/integrations/social/podcast.publish';

describe('readPodcastConfig', () => {
  it('reads the API URL without trailing slashes and the token', () => {
    expect(
      readPodcastConfig({
        PODCASTS_API_URL: ' https://api.example.com/v1// ',
        PODCASTS_SERVICE_TOKEN: ' secret ',
      })
    ).toEqual({ url: 'https://api.example.com/v1', token: 'secret' });
  });

  it('is undefined when either variable is missing', () => {
    expect(
      readPodcastConfig({ PODCASTS_API_URL: 'https://a' })
    ).toBeUndefined();
    expect(readPodcastConfig({ PODCASTS_SERVICE_TOKEN: 't' })).toBeUndefined();
  });
});

describe('episodeIdOf', () => {
  it('prefers the episodeId setting', () => {
    expect(
      episodeIdOf({ settings: { episodeId: ' ep_1 ' }, message: 'ep_2' })
    ).toBe('ep_1');
  });

  it('falls back to the post text', () => {
    expect(episodeIdOf({ settings: {}, message: ' ep-2\n' })).toBe('ep-2');
  });

  it('rejects text that is not an ID', () => {
    expect(
      episodeIdOf({ settings: {}, message: 'New episode out now' })
    ).toBeUndefined();
    expect(episodeIdOf({ settings: {}, message: '' })).toBeUndefined();
  });
});

describe('publish request', () => {
  const config = { url: 'https://api.example.com', token: 'secret' };

  it('targets the episode publish route', () => {
    expect(publishUrl(config, 'ep_1')).toBe(
      'https://api.example.com/episodes/ep_1/publish'
    );
  });

  it('sends the service token and the post ID as idempotency key', () => {
    expect(publishHeaders(config, 'post-1')).toEqual({
      Authorization: 'Bearer secret',
      'Idempotency-Key': 'post-1',
      Accept: 'application/json',
    });
  });
});

describe('publishOutcome', () => {
  it.each([
    [200, 'published'],
    [202, 'published'],
    [204, 'published'],
    [400, 'rejected'],
    [401, 'rejected'],
    [404, 'rejected'],
    [409, 'rejected'],
    [429, 'retry'],
    [500, 'retry'],
    [503, 'retry'],
  ])('maps HTTP %i to %s', (status, outcome) => {
    expect(publishOutcome(status)).toBe(outcome);
  });
});

describe('rejectionMessage', () => {
  it('uses a Stripe-style error message', () => {
    expect(
      rejectionMessage(
        422,
        JSON.stringify({ error: { code: 'not_ready', message: 'No audio' } })
      )
    ).toBe('No audio');
  });

  it('falls back to the status', () => {
    expect(rejectionMessage(404, '<html>')).toBe(
      'The podcasts API refused to publish the episode (HTTP 404)'
    );
  });
});

describe('releaseUrlOf', () => {
  it('reads the url from the response', () => {
    expect(releaseUrlOf('{"url":"https://pod.example.com/e/1"}')).toBe(
      'https://pod.example.com/e/1'
    );
  });

  it('is empty without one', () => {
    expect(releaseUrlOf('')).toBe('');
    expect(releaseUrlOf('{"id":"ep_1"}')).toBe('');
  });
});
