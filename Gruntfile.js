module.exports = function(grunt) {
  const typescript = require('@rollup/plugin-typescript')
  const commonjs = require('@rollup/plugin-commonjs')

  const config = require('./.screeps.json');
  grunt.initConfig({
    'eslint': {
      target: ['src/**/*.ts'],
    },
    'mochaTest': {
      test: {
        options: {
          reporter: 'spec',
          require: [
            'ts-node/register',
            './src/test_globals.ts',
          ],
        },
        src: ['src/**/*.test.ts'],
      },
    },
    'rollup': {
      options: {
        format: 'cjs',
        plugins: [
          typescript({module: "esnext"}),
          commonjs(),
        ],
      },
      main: {
        files: {
          'dist/main.js': 'src/main.ts',
        },
      }
    },
    'ts': {
      default: {
        tsconfig: './tsconfig.json',
      },
    },
    'githash': {
      main: {
        options: {},
      },
    },
    'regex-replace': {
      gitsha: { // specify a target with any name
        src: ['dist/main.js'],
        actions: [
          {
            name: 'gitsha',
            search: '__GIT_SHA__',
            replace: '<%= githash.main.hash %>',
            flags: '',
          },
        ],
      },
    },
    'clean': {
      'dist': ['dist'],
    },
    'screeps': {
      mmo: {
        options: {
          email: config.email,
          token: config.token,
          branch: config.branch,
          ptr: config.ptr,
        },
        src: ['dist/main.js'],
      },
      season: {
        options: {
          server: 'season',
          email: config.email,
          token: config.token,
          branch: config.branch,
          ptr: config.ptr,
        },
        src: ['dist/main.js'],
      },
      local: {
        options: {
          server: {
            host: 'localhost',
            port: 21025,
            path: '/api/user/code',
            http: true,
          },
          email: config.private.username,
          password: config.private.password,
          branch: config.private.branch,
          ptr: false,
        },
        src: ['dist/main.js'],
      },
      private: {
        options: {
          server: {
            host: '192.168.1.23',
            port: 21025,
            path: '/api/user/code',
            http: true,
          },
          email: config.private.username,
          password: config.private.password,
          branch: config.private.branch,
          ptr: false,
        },
        src: ['dist/main.js'],
      },
      privateOther: {
        options: {
          server: {
            host: '10.4.0.2',
            port: 21025,
            path: '/api/user/code',
            http: true,
          },
          email: config.private.username,
          password: config.private.password,
          branch: config.private.branch,
          ptr: false,
        },
        src: ['dist/main.js'],
      },
    },
  });

  grunt.loadNpmTasks('grunt-screeps');
  grunt.loadNpmTasks('grunt-ts');
  grunt.loadNpmTasks('grunt-eslint');
  grunt.loadNpmTasks('grunt-mocha-test');
  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-regex-replace');
  grunt.loadNpmTasks('grunt-githash');
  grunt.loadNpmTasks('grunt-rollup');

  grunt.registerTask('prune', '', function() {
    const exec = require('child_process').execSync;
    const result = exec('./node_modules/.bin/ts-prune', {encoding: 'utf8'});
    if (result) {
      grunt.log.writeln(result);
      return false;
    }
  });

  grunt.registerTask('test', ['eslint', 'mochaTest']);
  grunt.registerTask('build', ['clean', 'rollup:main', 'githash', 'regex-replace:gitsha']);
  grunt.registerTask('default', ['test', 'build']);

  // Tasks for uploading to specific servers
  grunt.registerTask('mmo', ['default', 'screeps:mmo']);
  grunt.registerTask('season', ['default', 'screeps:season']);
  grunt.registerTask('private', ['default', 'screeps:private']);
  grunt.registerTask('local', ['default', 'screeps:local']);
  grunt.registerTask('privateOther', ['default', 'screeps:privateOther']);
};
