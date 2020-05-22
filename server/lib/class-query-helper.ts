import { campClassMaxDays, tzOpts } from 'common';
import { ClassModel, CourseModel, SessionModel } from 'models';
import { DateTime } from 'luxon';
import { Includeable, Op, WhereOptions } from 'sequelize';
import { QueryArgs } from '../../types';

export default async function queryUpcomingClasses(args: QueryArgs.Classes) {
  const local = DateTime.local();

  const include: Includeable[] = [];
  const where: WhereOptions = {
    active: true,
    startDate: {
      [Op.gte]: local.plus({ minutes: 30 }).toJSDate(),
      [Op.lte]: local.plus({ weeks: 8 }).toJSDate()
    }
  };

  if (args.camps) {
    where.days = {
      [Op.gte]: 4,
      [Op.lt]: campClassMaxDays
    };
  }

  if (args.courseId) {
    include.push({
      model: CourseModel,
      where: {
        id: args.courseId
      }
    });
  } else if (args.subjectId) {
    include.push({
      model: CourseModel,
      where: {
        subjectId: args.subjectId,
        level: {
          [Op.gte]: 0
        }
      }
    });
  } else {
    include.push(CourseModel);
  }

  let klasses = await ClassModel.scope(['defaultScope', 'countStudent']).findAll({
    order: [['startDate', 'ASC']],
    include,
    where
  });

  const trialCutoff = local.plus({ hours: 3 }).toJSDate();
  const paidCutoff = local.plus({ days: 2 }).toJSDate();

  klasses = klasses.filter(k => {
    if (k.sessions.length === 0) {
      // bad metadata
      return false;
    }

    if (k.numberOfRegistrations === 0) {
      if (k.sessions.length === 1) {
        if (k.startDate < trialCutoff) {
          return false;
        }
      } else {
        if (k.startDate < paidCutoff) {
          return false;
        }
      }
    }

    return true;
  });

  if (args.courseId && klasses.length > 5) {
    let hasOpen = false;
    klasses = klasses.filter(k => {
      if (k.numberOfRegistrations >= k.course.capacity) {
        return hasOpen;
      }

      hasOpen = true;
      return true;
    });
  }

  return klasses;
}

export function buildNextClass(current: ClassModel, course: CourseModel) {
  const schedules = buildSchedules(current, course.duration);
  return new ClassModel(
    {
      courseId: course.id,
      startDate: schedules[0][0],
      endDate: schedules[schedules.length - 1][1],
      details: {
        seedClassId: current.id,
        autoGenerated: true
      },
      sessions: schedules.map((ses, idx) => ({
        idx,
        startDate: ses[0],
        endDate: ses[1]
      }))
    },
    { include: [SessionModel] }
  );
}

function buildSchedules(
  klass: ClassModel,
  minutes: number
): ClassModel['schedules'] {
  const weekdays: number[] = [];
  const startDates: DateTime[] = [];
  for (const ses of klass.sessions) {
    const dt = DateTime.fromJSDate(ses.startDate, tzOpts);
    weekdays.push(dt.get('weekday'));
    startDates.push(dt);
  }

  if (klass.isWeekly()) {
    let dts = startDates[startDates.length - 1];
    return klass.sessions.map(() => {
      dts = dts.plus({ week: 1 });
      return [dts.toJSDate(), dts.plus({ minutes }).toJSDate()];
    });
  }

  // pattern 1, twice a week for two weeks
  if (weekdays[0] === weekdays[2] && weekdays[1] === weekdays[3]) {
    return startDates.map(dt => {
      const dts = dt.plus({ weeks: 2 });
      return [dts.toJSDate(), dts.plus({ minutes }).toJSDate()];
    });
  }

  // pattern 2: 1/3/5
  if (
    (weekdays[0] === 1 && weekdays[1] === 3) ||
    (weekdays[0] === 3 && weekdays[1] === 5) ||
    (weekdays[0] === 5 && weekdays[1] === 1)
  ) {
    let dts = startDates[startDates.length - 1];
    return weekdays.map(weekday => {
      dts = dts.plus({ days: weekday === 5 ? 3 : 2 });
      return [dts.toJSDate(), dts.plus({ minutes }).toJSDate()];
    });
  }

  // pattern 3: 2/4/6
  if (
    (weekdays[0] === 2 && weekdays[1] === 4) ||
    (weekdays[0] === 4 && weekdays[1] === 6) ||
    (weekdays[0] === 6 && weekdays[1] === 2)
  ) {
    let dts = startDates[startDates.length - 1];
    return weekdays.map(weekday => {
      dts = dts.plus({ days: weekday === 6 ? 3 : 2 });
      return [dts.toJSDate(), dts.plus({ minutes }).toJSDate()];
    });
  }

  // pattern 4: 2/4/7
  if (
    (weekdays[0] === 2 && weekdays[1] === 4) ||
    (weekdays[0] === 4 && weekdays[1] === 7) ||
    (weekdays[0] === 7 && weekdays[1] === 2)
  ) {
    let dts = startDates[startDates.length - 1];
    return weekdays.map(weekday => {
      dts = dts.plus({ days: weekday === 4 ? 3 : 2 });
      return [dts.toJSDate(), dts.plus({ minutes }).toJSDate()];
    });
  }

  // whatever, just do every other day
  let dts = startDates[startDates.length - 1];
  return klass.sessions.map(() => {
    dts = dts.plus({ days: 2 });
    return [dts.toJSDate(), dts.plus({ minutes }).toJSDate()];
  });
}