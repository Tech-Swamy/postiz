'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { PodcastDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/podcast.dto';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { Input } from '@gitroom/react/form/input';
import { useT } from '@gitroom/react/translation/get.transation.service.client';

const PodcastSettings: FC = () => {
  const form = useSettings();
  const t = useT();

  return (
    <div>
      <Input
        label={t('episode_id', 'Episode ID')}
        placeholder="ep_123"
        {...form.register('episodeId')}
      />
    </div>
  );
};

export default withProvider({
  postComment: PostComment.POST,
  minimumCharacters: [],
  SettingsComponent: PodcastSettings,
  CustomPreviewComponent: undefined,
  dto: PodcastDto,
  maximumCharacters: 1000,
});
