import { api } from "../api/client";
import type { AssetInfo, ProjectInfo } from "../api/types";
import { uid } from "./format";

/**
 * Create a new Studio project containing one asset as its first clip.
 * This mirrors what the "Send to Studio" action promises in the interface.
 */
export async function addAssetToNewProject(asset: AssetInfo, name?: string): Promise<ProjectInfo> {
  const project = await api.createProject({
    name: name ?? asset.name,
    sample_rate: asset.sample_rate,
  });
  const document = project.document;
  document.tracks = [
    {
      id: uid("trk"),
      name: asset.name,
      volume: 1,
      pan: 0,
      mute: false,
      solo: false,
      clips: [
        {
          id: uid("clip"),
          asset_id: asset.id,
          start: 0,
          offset: 0,
          duration: asset.duration,
          fade_in: 0,
          fade_out: 0,
          gain: 1,
        },
      ],
    },
  ];
  return api.updateProject(project.id, { document });
}
