import { json } from '../../lib/utils/api';
import { getPublicConfig } from '../../lib/services/config.server';

export async function loader() {
  return json(getPublicConfig());
}
