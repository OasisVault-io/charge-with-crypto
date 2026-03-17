import { json } from '../../lib/utils/api';
import { getPublicConfig } from '../../lib/services/configService';

export async function loader() {
  return json(getPublicConfig());
}
