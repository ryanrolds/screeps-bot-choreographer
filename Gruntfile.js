module.exports = function(grunt) {
  const config = require('./.screeps.json')
  grunt.initConfig({
    eslint: {
      options: {
        configFile: '.eslintrc.yml',
      },
      target: ['src/**/*.js']
    },
    mochaTest: {
      test: {
        options: {
          reporter: 'spec',
          require: [
            'ts-node/register',
            './src/test_globals.ts'
          ]
        },
        src: ['src/**/*.test.ts']
      }
    },
    ts: {
      default: {
        tsconfig: './tsconfig.json'
      }
    },
    githash: {
      main: {
        options: {},
      }
    },
    "regex-replace": {
      gitsha: { //specify a target with any name
        src: ['built/main.js'],
        actions: [
          {
            name: 'gitsha',
            search: '__GIT_SHA__',
            replace: '<%= githash.main.hash %>',
            flags: ''
          }
        ]
      }
    },
    clean: {
      'built': ['built']
    },
    screeps: {
      mmo: {
        options: {
          email: config.email,
          token: config.token,
          branch: config.branch,
          ptr: config.ptr
        },
        src: ['built/*.js']
      },
      season: {
        options: {
          server: 'season',
          email: config.email,
          token: config.token,
          branch: config.branch,
          ptr: config.ptr
        },
        src: ['built/*.js']
      },
      local: {
        options: {
          server: {
            host: 'localhost',
            port: 21025,
            path: '/api/user/code',
            http: true
          },
          email: config.private.username,
          password: config.private.password,
          branch: config.private.branch,
          ptr: false
        },
        src: ['built/*.js']
      },
      private: {
        options: {
          server: {
            host: '192.168.1.23',
            port: 21025,
            path: '/api/user/code',
            http: true
          },
          email: config.private.username,
          password: config.private.password,
          branch: config.private.branch,
          ptr: false
        },
        src: ['built/*.js']
      }
    },
  });

  grunt.loadNpmTasks('grunt-screeps');
  grunt.loadNpmTasks("grunt-ts");
  grunt.loadNpmTasks("grunt-eslint");
  grunt.loadNpmTasks('grunt-mocha-test');
  grunt.loadNpmTasks('grunt-contrib-clean')
  grunt.loadNpmTasks('grunt-regex-replace');
  grunt.loadNpmTasks('grunt-githash');

  grunt.registerTask('prune', '', function() {
    var exec = require('child_process').execSync;
    var result = exec("./node_modules/.bin/ts-prune", {encoding: 'utf8'});
    if (result) {
      grunt.log.writeln(result);
      return false;
    }
  });

  grunt.registerTask('test', ['mochaTest']);
  grunt.registerTask('check', ['mochaTest']);
  grunt.registerTask("build", ["clean", "ts", "githash", "regex-replace:gitsha"]);
  grunt.registerTask("default", ["check", "build"]);

  // Tasks for uploading to specific servers
  grunt.registerTask("mmo", ["default", "screeps:mmo"]);
  grunt.registerTask("season", ["default", "screeps:season"]);
  grunt.registerTask("private", ["default", "screeps:private"]);
  grunt.registerTask("local", ["default", "screeps:local"]);

}
