import { getAppContext } from '../../lib/runtime';
import { json } from '../../lib/utils/api';

export async function loader() {
  return json(getAppContext().configService.getPublicConfig());
}
