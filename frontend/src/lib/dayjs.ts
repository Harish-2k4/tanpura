// dayjs with the plugins the date pickers need for time zones. Import dayjs from here.
import dayjs from 'dayjs';
import 'dayjs/locale/en-gb';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.locale('en-gb');

export default dayjs;
