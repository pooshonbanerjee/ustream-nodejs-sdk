const ApiResource = require('./api_resource')
const PageableApiResource = require('./pageable_api_resource')
const Ftp = require('ftp')
const qs = require('qs')
const fs = require('fs') //by pooshonbanerjee
// var events = require('events'); //by pooshonbanerjee

/**
 * Class Video
 *
 * Implementation of Ustream's video API.
 *
 * @class
 * @link http://developers.Ustream.tv/broadcasting-api/channel.html
 */
class Video extends ApiResource {
  /**
   * Lists all videos on an account.
   *
   * @param {string} channelId - ID of a channel.
   * @param {Number} pageSize  - The number of results to show per page.
   * @param {Number} page      - The page to retrieve.
   *
   * @returns {Promise}
   */
  list (channelId, pageSize = 100, page = 1) {
    return new Promise((resolve, reject) => {
      /**
       * @var {{videos, paging}} res
       */
      this.context.authRequest('get', `/channels/${channelId}/videos.json?pagesize=${pageSize}&page=${page}`)
        .then((res) => {
          resolve(new PageableApiResource(this.context, 'videos', res.videos, res.paging))
        }).catch((err) => {
          reject(err)
        })
    })
  }

  /**
   * Get video fields, including title, description, url, etc.
   *
   * @param {Number} videoId - ID of existing video
   */
  get (videoId) {
    return new Promise((resolve, reject) => {
      this.context.authRequest('get', `/videos/${videoId}.json`).then((res) => {
        resolve(res.video)
      }).catch((err) => {
        reject(err)
      })
    })
  }

  /**
   * Delete video from Ustream.
   *
   * @param {Number} videoId - ID of existing video
   */
  remove (videoId) {
    return new Promise((resolve, reject) => {
      this.context.authRequest('delete', `/videos/${videoId}.json`).then((res) => {
        resolve(res)
      }).catch((err) => {
        reject(err)
      })
    })
  }

  /**
   * Check the status of an uploaded video.
   *
   * Possible returned statuses are:
   *    - initiated
   *    - transferred
   *    - queued
   *    - pending
   *    - transcoding
   *    - complete
   *    - error
   *
   * @param {Number} channelId
   * @param {Number} videoId
   */
  getStatus (channelId, videoId) {
    return this.context.authRequest('get', `/channels/${channelId}/uploads/${videoId}.json`)
  }

  /**
   * Uploads a video to Ustream.
   *
   * @param {Number} channelId
   * @param {{}}     opts
   * @param {string} opts.title       - (optional) Video title.
   * @param {string} opts.description - (optional) Video description.
   * @param {string} opts.protect     - (optional) Protection level. Acceptable values are "public" or "private".
   *                                               Default value is "private".
   * @param {{originalname, stream}} file
   * @param {stream} file.stream
   *
   * @return {Promise}
   */

  upload (channelId, file, opts) {
    console.log("ustream-sdk.upload called");
    const self = this
    let ext = file.originalname.substr(file.originalname.lastIndexOf('.') + 1)

    return this._initiateUpload(channelId, opts)
      .then((res) => {
        return self._ftpUpload(res.host, res.user, res.password, res.port, `${res.path}.${ext}`, file.stream, file.fpath)
          .then(() => {
            return self._completeUpload(channelId, res['videoId'], 'ready')
          })
      })
  }

  /**
   * Initiates a video upload.
   *
   * @param {Number} channelId       - ID of a Ustream channel.
   * @param {{}}     opts
   * @param {string} opts.title       - (optional) Video title.
   * @param {string} opts.description - (optional) Video description.
   * @param {string} opts.protect     - (optional) Protection level. Acceptable values are "public" or "private".
   *                                               Default value is "public".
   *
   * @return {Promise}
   *
   * @private
   */

  _initiateUpload (channelId, opts) {
    console.log("ustream-sdk._initiateUpload called");
    return this.context.authRequest('post', `/channels/${channelId}/uploads.json?type=videoupload-ftp`, qs.stringify(opts))
  }

  /**
   * Uploads video binary stream.
   *
   * The method _initiate upload must be executed immediately before this method.
   *
   * @param {string} ftpHost  - Remote host server.
   * @param {string} ftpUser  - FTP username.
   * @param {string} ftpPass  - FTP password.
   * @param {Number} ftpPort  - FTP port.
   * @param {string} ftpDest  - Destination on remote server.
   * @param {Stream} stream
   *
   * @return {Promise}
   *
   * @private
   */
  _ftpUpload (ftpHost, ftpUser, ftpPass, ftpPort, ftpDest, stream, fpath) { //fpath added by pooshonbanerjee
    console.log("ustream-sdk._ftpUpload called");
    let ftp = new Ftp()

    return new Promise((resolve, reject) => {
      ftp.binary((err) => {
        if (err) {
          return reject(new Error('Failed to set FTP transfer type to binary.'))
        }
        console.log('binary file mode set');
      })
      // By pooshonbanerjee
      let uploadedSize = 0;
      let fsize = 0;
      fs.stat(fpath, (err, stats) => {
        if (err) throw err;
        // console.log(`stats: ${JSON.stringify(stats)}`);
        fsize = stats.size;
      });

      //
      ftp.on('ready', () => {

        stream.on('data', function(buffer) {
          var segmentLength = buffer.length;
          var prog={total:0,loaded:0, status:'init'};
          uploadedSize += segmentLength;
          // console.log("Progress: ",((uploadedSize/fsize*100).toFixed(0)+"%"));
          if(ftpQ.getItem(fpath)){
            prog = JSON.parse(ftpQ.getItem(fpath));
          }
          var progress_object = {total:fsize,loaded:uploadedSize, status:'processing'};
          var current_prog = (uploadedSize/fsize*100).toFixed(0);
          var old_prog = (prog.total>0)?((prog.loaded/prog.total*100).toFixed(0)):0;
          // console.log(current_prog,":",old_prog);
          if((current_prog - old_prog)>3){
              ftpQ.setItem(fpath,JSON.stringify(progress_object));
              console.log("ftpQ printed in ftp.put() -> ",fpath," = ",ftpQ.getItem(fpath),' | ',current_prog,"%");
          }

          // ftpQ[fpath] = progress_object;

        });

        ftp.put(stream, ftpDest, (err) => {
          ftp.end()

          if (err) {
            console.log('ftp put method has thrown some error');
            ftpQ.setItem(fpath,JSON.stringify({error_msg:err.message}));
            return reject(err)
          }

          return resolve()
        })
      })

      ftp.on('error', (err) => {
        console.log('ftp put error is caught on(error) -> printing object :: ', err);
        return reject(err)
      })

      ftp.connect({
        host: `${ftpHost}`,
        port: ftpPort,
        user: ftpUser,
        password: ftpPass
      })
    })
  }

  /**
   * Signals that FTP file transfer is complete.
   *
   * Must be executed after _ftpUpload().
   *
   * @param {Number}   channelId - ID of Ustream channel.
   * @param {Number}   videoId   - ID of Ustream video.
   * @param {string}   status     - Status of video. Default is "ready".
   *
   * @return {Promise}
   *
   * @private
   */
  _completeUpload (channelId, videoId, status) {
    status = (status !== null) ? status : 'ready'
    let payload = qs.stringify({status: status})

    return this.context.authRequest('put', `/channels/${channelId}/uploads/${videoId}.json`, payload)
      .then((res) => {
        return Promise.resolve({
          channelId: channelId,
          videoId: videoId
        })
      })
  }
}

module.exports = Video
