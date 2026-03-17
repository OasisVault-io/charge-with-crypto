import { json } from '../../lib/utils/api';
import { getHealth } from '../../lib/services/configService';

export async function loader() {
  return json(getHealth());
}
