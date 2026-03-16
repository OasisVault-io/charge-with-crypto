import { json } from '../../lib/utils/api';
import { getHealth } from '../../lib/services/config.server';

export async function loader() {
  return json(getHealth());
}
