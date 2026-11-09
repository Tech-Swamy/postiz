import { IsOptional, IsString, Matches } from 'class-validator';

export const EPISODE_ID = /^[A-Za-z0-9_-]+$/;

export class PodcastDto {
  @IsOptional()
  @IsString()
  @Matches(EPISODE_ID, {
    message: 'The episode ID can only have letters, digits, - and _',
  })
  episodeId?: string;
}
