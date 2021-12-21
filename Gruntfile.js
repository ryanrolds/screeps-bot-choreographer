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
    clean: {
      'built': ['built']
    },
    screeps: {
      mmo: {
        options: {
          email: config.email,
          password: config.password,
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

  grunt.registerTask('check', ['eslint', 'mochaTest']);
  grunt.registerTask("build", ["clean", "ts"]);
  grunt.registerTask("default", ["check", "build"]);

  // Tasks for uploading to specific servers
  grunt.registerTask("mmo", ["default", "screeps:mmo"]);
  grunt.registerTask("local", ["default", "screeps:local"]);
  grunt.registerTask("private", ["default", "screeps:private"]);
}
