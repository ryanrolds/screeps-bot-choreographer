import {Kernel} from './kernel';
import {Tracer} from './lib.tracing';
import {sleeping} from './os.process';
import {Runnable} from './os.runnable';

const CLEANUP_INTERVAL = 100;
const SITE_TTL = 1000;

type SiteEntry = {
  id: string;
  completeness: number;
  observed: number;
};

export class SiteJanitor implements Runnable {
  sites: Map<string, SiteEntry>;

  constructor() {
    this.sites = new Map<string, SiteEntry>();
  }

  run(kernel: Kernel, trace: Tracer) {
    trace.warn('running site janitor');

    let purged = 0;
    let created = 0;
    let updated = 0;
    let removed = 0;

    _.each(this.sites, (entry) => {
      // remove entry if site does not exist in game
      if (!Game.constructionSites[entry.id]) {
        purged++;
        delete this.sites[entry.id];
      }
    });

    _.each(Game.constructionSites, (site) => {
      // if we have not seen the site, add an entry
      if (!this.sites[site.id]) {
        this.sites[site.id] = {
          id: site.id,
          completeness: site.progress,
          observed: Game.time,
        };

        created++;
        return;
      }

      // if we have seen the site and the progress is different, update the observed time
      if (this.sites[site.id].completeness !== site.progress) {
        this.sites[site.id].completeness = site.progress;
        this.sites[site.id].observed = Game.time;

        updated++;
        return;
      }

      // if the site has been observed for too long, remove it
      if (Game.time - this.sites[site.id].observed > SITE_TTL) {
        site.remove();
        delete this.sites[site.id];

        removed++;
        return;
      }
    });

    trace.log('site janitor stats', {
      purged,
      created,
      updated,
      removed,
    });

    return sleeping(CLEANUP_INTERVAL);
  }
}
