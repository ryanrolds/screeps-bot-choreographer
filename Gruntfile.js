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
    screeps: {
      options: {
        email: config.email,
        password: config.password,
        branch: config.branch,
        ptr: config.ptr
      },
      dist: {
        src: ['built/*.js']
      }
    }
  });

  grunt.loadNpmTasks('grunt-screeps');
  grunt.loadNpmTasks("grunt-ts");
  grunt.loadNpmTasks("grunt-eslint");
  grunt.loadNpmTasks('grunt-mocha-test');

  grunt.registerTask("default", ["eslint", "mochaTest", "ts"]);
  grunt.registerTask("upload", ["default", "screeps"]);
}
